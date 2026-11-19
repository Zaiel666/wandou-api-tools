using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

// Installation replaces only hash-identified program files. Unknown files in
// both the root and nested program directories stay in place.
public static class LocalInstallerCore
{
    [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int processId);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder name,ref uint length);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    public static readonly string[] Managed = { "豌豆AI工具.exe", "程序文件", "resources", "网页版.html", "使用说明.txt", ManagedUpdateCore.ManifestName };
    static readonly StringComparer Names = StringComparer.OrdinalIgnoreCase;
    public static string Extended(string value) { return value.StartsWith(@"\\?\") ? value : @"\\?\" + Path.GetFullPath(value); }
    public static void EnableLongPaths() { AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling", false); AppContext.SetSwitch("Switch.System.IO.BlockLongPaths", false); }
    static bool Exists(string p) { return File.Exists(Extended(p)) || Directory.Exists(Extended(p)); }
    static Dictionary<string,object> ReadObject(string file)
    {
        if(new FileInfo(Extended(file)).Length>1024*1024)throw new IOException("存储配置文件过大，请先检查旧软件的存储设置。");
        return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Extended(file)));
    }
    public static string PortableProfileDirectory(string profile)
    {
        var file=Path.Combine(profile,"project-storage.json");if(!File.Exists(Extended(file)))return "";
        var settings=ReadObject(file);object raw; if(!settings.TryGetValue("active",out raw)||raw==null)return "";
        var active=raw as Dictionary<string,object>;object mode,location;
        if(active==null||!active.TryGetValue("mode",out mode)||!Object.Equals(mode,"portable")||!active.TryGetValue("directory",out location))return "";
        return Path.GetDirectoryName(Path.GetFullPath(Convert.ToString(location)));
    }
    public static void VerifyPortableProfile(string profile,string target)
    {
        var old=PortableProfileDirectory(profile); if(String.IsNullOrEmpty(old)||Names.Equals(Path.GetFullPath(old),Path.GetFullPath(target)))return;
        var marker=Path.Combine(target,"豌豆AI数据",".wandou-project-storage.json");
        if(File.Exists(Extended(marker)))
        {
            var settings=ReadObject(Path.Combine(profile,"project-storage.json"));var active=settings["active"] as Dictionary<string,object>;var copy=ReadObject(marker);object originalId,copiedId;
            if(active!=null&&active.TryGetValue("id",out originalId)&&copy.TryGetValue("id",out copiedId)&&Object.Equals(originalId,copiedId))return;
        }
        throw new IOException("现有画布随旧程序保存。请升级到原目录："+old+"。如需更换安装位置，请先在旧软件“存储设置”选择独立数据目录，或完整复制含“豌豆AI数据”的软件目录；安装器不会搬动或丢弃旧项目。");
    }
    static void Move(string from, string to) { if (Directory.Exists(Extended(from))) Directory.Move(Extended(from), Extended(to)); else File.Move(Extended(from), Extended(to)); }
    static void CheckNoLinks(string target)
    {
        for (var item = Path.GetFullPath(target); !String.IsNullOrEmpty(item); item = Path.GetDirectoryName(item))
            if (Exists(item) && (File.GetAttributes(Extended(item)) & FileAttributes.ReparsePoint) != 0)
                throw new IOException("安装路径不能经过链接或重定向目录，请选择普通文件夹。");
    }
    static void CheckTree(string root)
    {
        if (!Exists(root)) return;
        if ((File.GetAttributes(Extended(root)) & FileAttributes.ReparsePoint) != 0) throw new IOException("程序目录含链接，已停止安装。");
        if (Array.Exists(new[] { "豌豆AI数据", "canvas-media", "canvas-backups", "local-data", "export-artifacts" }, name => Names.Equals(Path.GetFileName(root),name))) throw new IOException("程序文件内发现项目数据，请先在软件中迁移到独立数据目录后再安装。");
        if (Directory.Exists(Extended(root))) foreach (var entry in Directory.GetFileSystemEntries(Extended(root))) CheckTree(entry);
    }
    static void CheckRunning(string target)
    {
        var prefix = Path.GetFullPath(target).TrimEnd('\\') + "\\";
        foreach (var processName in new[] { "豌豆AI工具", "electron" }) foreach (var p in Process.GetProcessesByName(processName)) using (p)
        {
            if (p.Id == Process.GetCurrentProcess().Id) continue;
            // Querying every process module can stall on unrelated protected
            // services. Only the two executable names shipped by this app can
            // hold an installation open; filesystem locks are a second gate.
            string filename = null;
            var handle=OpenProcess(0x1000,false,p.Id);
            if(handle!=IntPtr.Zero)try { var name=new StringBuilder(32768);uint size=(uint)name.Capacity;if(QueryFullProcessImageName(handle,0,name,ref size))filename=name.ToString(); }finally{CloseHandle(handle);}
            if (filename != null && filename.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                throw new IOException("请先保存并正常退出此目录中的豌豆 AI，再开始安装。安装器不会强制结束任务。");
        }
    }
    public static string ValidateTarget(string value)
    {
        if (String.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value) || value.StartsWith(@"\\")) throw new IOException("请选择本机磁盘中的完整路径。");
        var target = Path.GetFullPath(value).TrimEnd('\\');
        if (target.Length < 4 || Names.Equals(target, Path.GetPathRoot(target).TrimEnd('\\'))) throw new IOException("请选择专用的软件文件夹，不能直接安装到磁盘根目录。");
        if (target.Length > 200) throw new IOException("安装目录太深：请选择更靠近磁盘根目录的专用文件夹。安装器还会根据包内文件检查后续更新的路径余量。");
        foreach (var part in target.Substring(3).Split('\\'))
            if (part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new IOException("目录名称含 Windows 不支持的字符。");
        foreach (var protectedRoot in new[] { Environment.GetFolderPath(Environment.SpecialFolder.Windows), Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData) })
            if (Names.Equals(target, protectedRoot)) throw new IOException("请在此目录下选择专用的豌豆 AI 文件夹。");
        CheckNoLinks(target);
        if (Directory.Exists(Extended(target)))
        {
            var contents = Directory.GetFileSystemEntries(Extended(target));
            if (contents.Length > 0 && !(File.Exists(Extended(Path.Combine(target, "豌豆AI工具.exe"))) && Directory.Exists(Extended(Path.Combine(target, "程序文件")))))
                throw new IOException("目标文件夹已有其他内容，请选择空文件夹或已有的新版豌豆 AI 程序目录。现有文件不会被覆盖。");
        }
        foreach (var name in Managed) CheckTree(Path.Combine(target, name));
        CheckRunning(target);
        return target;
    }
    public static List<ZipArchiveEntry> ValidateArchive(ZipArchive zip, string target, out long bytes)
    {
        ManagedUpdateCore.ValidateArchive(zip);
        bytes = 0;
        var entries = new List<ZipArchiveEntry>(); var unique = new HashSet<string>(Names);
        foreach (var entry in zip.Entries)
        {
            var name = entry.FullName.Replace('\\', '/'); var parts = name.TrimEnd('/').Split('/');
            if (name.StartsWith("/") || name.IndexOf(':') >= 0 || !Array.Exists(Managed, item => Names.Equals(item, parts[0]))) throw new IOException("安装包含非程序文件或不安全路径。");
            foreach (var part in parts)
                if (String.IsNullOrEmpty(part) || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0
                    || Names.Equals(part, "豌豆AI数据") || Names.Equals(part, "canvas-media") || Names.Equals(part, "canvas-backups") || Names.Equals(part, "project-storage.json")) throw new IOException("安装包路径无效或包含用户数据。");
            if (!unique.Add(name.TrimEnd('/'))) throw new IOException("安装包包含重复路径。");
            if (((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000 || (entry.ExternalAttributes & 0x400) != 0) throw new IOException("安装包不能包含链接。");
            if (target.Length + name.Length + 1 > 30000) throw new IOException("安装包路径过长。");
            bytes = checked(bytes + entry.Length); entries.Add(entry);
        }
        foreach (var required in new[] { "豌豆AI工具.exe", "程序文件/豌豆AI工具.exe", "程序文件/resources/app/VERSION.txt", "程序文件/resources/app/index.html", "resources/app/VERSION.txt", "网页版.html", "使用说明.txt" })
            if (!unique.Contains(required)) throw new IOException("安装包缺少必要文件：" + required);
        // The current updater also uses ordinary .NET/Win32 paths. Reserve its
        // longest real staging/rollback suffix, not just the installed path.
        // Keep every resulting path below 240 chars for directory operations.
        foreach(var entry in entries)
        {
            var relative=entry.FullName.Replace('/','\\').TrimEnd('\\');
            var updateStage=Path.Combine(Path.GetDirectoryName(target),".wandou-program-stage-"+new String('a',32),relative);
            var rollback=Path.Combine(Path.GetDirectoryName(target),ManagedUpdateCore.BackupPrefix(target)+new String('a',32),"files",relative);
            if(Path.Combine(target,relative).Length>240||updateStage.Length>240||rollback.Length>240)
                throw new IOException("目标路径太深，当前安装包无法为后续更新和回退保留足够路径长度。请缩短上级目录，例如选择磁盘根目录下的“豌豆AI工具”。尚未写入安装文件。");
        }
        return entries;
    }
    public static string Install(Stream package, string directory, string expectedVersion, Action<int> progress, Action<string> shortcuts, Func<long> freeSpace, Action<string> fault)
    {
        // A second installer cannot interleave backup/commit/rollback for the
        // same target. No renderer input or update URL participates here.
        string key;
        using(var hash=SHA256.Create())key=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(directory).TrimEnd('\\','/').ToLowerInvariant()))).Replace("-","");
        using(var gate=new Mutex(false,@"Local\WandouInstall-"+key))
        {
            bool acquired=false;
            try { try{acquired=gate.WaitOne(0);}catch(AbandonedMutexException){acquired=true;}if(!acquired)throw new IOException("此目录已有安装任务，请等待完成后再试。");return InstallLocked(package,directory,expectedVersion,progress,shortcuts,freeSpace,fault); }
            finally{if(acquired)gate.ReleaseMutex();}
        }
    }
    static string InstallLocked(Stream package, string directory, string expectedVersion, Action<int> progress, Action<string> shortcuts, Func<long> freeSpace, Action<string> fault)
    {
        EnableLongPaths();
        CheckRunning(Path.GetFullPath(directory));
        ManagedUpdateCore.Recover(Path.GetFullPath(directory));
        var target = ValidateTarget(directory); var parent = Path.GetDirectoryName(target);
        string stage = Path.Combine(parent, ".wandou-install-stage-" + Guid.NewGuid().ToString("N"));
        string backup = Path.Combine(parent, ".wandou-install-backup-" + DateTime.Now.ToString("yyyyMMdd-HHmmss-") + Guid.NewGuid().ToString("N").Substring(0,8));
        var old = new List<string>(); var installed = new List<string>(); bool madeTarget = false, committed = false;
        using (var archive = new ZipArchive(package, ZipArchiveMode.Read, true))
        {
            long total; var entries = ValidateArchive(archive, target, out total);
            long available = freeSpace != null ? freeSpace() : new DriveInfo(Path.GetPathRoot(target)).AvailableFreeSpace;
            if (available < checked(total + 256L * 1024 * 1024)) throw new IOException("磁盘可用空间不足。需要解压空间及至少 256 MB 余量；原程序和数据不会删除。");
            Directory.CreateDirectory(Extended(parent)); CheckNoLinks(parent);
            try
            {
                Directory.CreateDirectory(Extended(stage)); long done = 0;
                foreach (var entry in entries)
                {
                    var file = Path.Combine(stage, entry.FullName.Replace('/', '\\'));
                    if (entry.FullName.EndsWith("/")) { Directory.CreateDirectory(Extended(file)); continue; }
                    Directory.CreateDirectory(Extended(Path.GetDirectoryName(file)));
                    using (var input = entry.Open()) using (var output = new FileStream(Extended(file), FileMode.CreateNew, FileAccess.Write, FileShare.None)) { input.CopyTo(output); output.Flush(true); }
                    if (new FileInfo(Extended(file)).Length != entry.Length) throw new IOException("文件校验失败：" + entry.FullName);
                    done += entry.Length; if (progress != null) progress((int)(done * 80 / Math.Max(1,total)));
                }
                foreach (var relative in new[] { "resources/app/VERSION.txt", "程序文件/resources/app/VERSION.txt" })
                    if (File.ReadAllText(Extended(Path.Combine(stage, relative.Replace('/', '\\')))).Trim().TrimStart('v') != expectedVersion) throw new IOException("安装包版本不一致，已停止。");
                if (fault != null) fault("extracted");
                ValidateTarget(target); // Recheck before changing any installed entry.
                madeTarget = !Directory.Exists(Extended(target)); Directory.CreateDirectory(Extended(target));
                backup = ManagedUpdateCore.Apply(stage,target,expectedVersion,fault,()=>{if(shortcuts!=null)shortcuts(target);});
                committed = true;
                try { foreach (var name in new[] { "程序文件", "resources" }) File.SetAttributes(Extended(Path.Combine(target,name)), File.GetAttributes(Extended(Path.Combine(target,name))) | FileAttributes.Hidden); } catch { }
                try { if (old.Count > 0) File.SetAttributes(Extended(backup), File.GetAttributes(Extended(backup)) | FileAttributes.Hidden); } catch { }
                if (progress != null) progress(100);
                return backup;
            }
            catch (Exception original)
            {
                if (!committed)
                {
                    try
                    {
                        for (int i=installed.Count-1;i>=0;i--) Move(Path.Combine(target,installed[i]),Path.Combine(stage,installed[i]));
                        for (int i=old.Count-1;i>=0;i--) Move(Path.Combine(backup,old[i]),Path.Combine(target,old[i]));
                        if (madeTarget && Directory.GetFileSystemEntries(Extended(target)).Length == 0) Directory.Delete(Extended(target));
                    }
                    catch (Exception rollback) { throw new IOException("安装未完成，回退遇到文件占用。请保留并恢复原程序备份：" + backup + "。原因：" + rollback.Message, original); }
                }
                throw;
            }
            finally
            {
                // Only this invocation's newly-created staging tree is disposable.
                try { if (Directory.Exists(Extended(stage))) Directory.Delete(Extended(stage),true); } catch { }
                try { if (Directory.Exists(Extended(backup)) && Directory.GetFileSystemEntries(Extended(backup)).Length==0) Directory.Delete(Extended(backup)); } catch { }
            }
        }
    }
    public static void CreateShortcuts(string target, string desktop, string menu)
    {
        var saved = new Dictionary<string,byte[]>(); var outputs = new List<string>();
        object shell = null;
        try
        {
            shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell",true));
            foreach (var folder in new[] { desktop, menu })
            {
                Directory.CreateDirectory(folder); var link = Path.Combine(folder,"豌豆AI工具.lnk");
                saved[link] = File.Exists(link) ? File.ReadAllBytes(link) : null; outputs.Add(link);
                object shortcut = shell.GetType().InvokeMember("CreateShortcut",BindingFlags.InvokeMethod,null,shell,new object[] {link});
                try
                {
                    shortcut.GetType().InvokeMember("TargetPath",BindingFlags.SetProperty,null,shortcut,new object[]{Path.Combine(target,"豌豆AI工具.exe")});
                    shortcut.GetType().InvokeMember("WorkingDirectory",BindingFlags.SetProperty,null,shortcut,new object[]{target});
                    shortcut.GetType().InvokeMember("Description",BindingFlags.SetProperty,null,shortcut,new object[]{"豌豆 AI 桌面版"});
                    shortcut.GetType().InvokeMember("Save",BindingFlags.InvokeMethod,null,shortcut,null);
                    if (!File.Exists(link)) throw new IOException("未能创建快捷方式。");
                }
                finally { if (System.Runtime.InteropServices.Marshal.IsComObject(shortcut)) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut); }
            }
        }
        catch { foreach(var link in outputs) { if (saved[link] == null) File.Delete(link); else File.WriteAllBytes(link,saved[link]); } throw; }
        finally { if(shell!=null && System.Runtime.InteropServices.Marshal.IsComObject(shell)) System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
    }
}

internal sealed class InstallerWindow : Form
{
    TextBox location = new TextBox(); Label status = new Label(); Button browse = new Button(), install = new Button(); ProgressBar progress = new ProgressBar(); bool running;
    public InstallerWindow()
    {
        Text = "豌豆 AI 安装 · " + InstallBuild.Version; Font = new Font("Microsoft YaHei",10); ClientSize = new Size(640,430); MinimumSize = new Size(580,440); StartPosition = FormStartPosition.CenterScreen; AutoScaleMode = AutoScaleMode.Dpi;
        var layout = new TableLayoutPanel { Dock=DockStyle.Fill,Padding=new Padding(24),RowCount=7,ColumnCount=1 };
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute,45)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,72)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,45)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,72)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,25)); layout.RowStyles.Add(new RowStyle(SizeType.Percent,100)); layout.RowStyles.Add(new RowStyle(SizeType.Absolute,45));
        layout.Controls.Add(new Label {Text="将豌豆 AI 安装到你选择的位置",Font=new Font(Font.FontFamily,16,FontStyle.Bold),Dock=DockStyle.Fill},0,0);
        layout.Controls.Add(new Label {Text="默认画布项目和原图保存在安装目录的“豌豆AI数据”。\n可选其他磁盘，安装后自动创建桌面和开始菜单快捷方式。",Dock=DockStyle.Fill},0,1);
        var row = new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=2}; row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,100)); location.Dock=DockStyle.Fill; location.Text=DefaultDirectory(); browse.Text="选择目录…"; browse.Dock=DockStyle.Fill; row.Controls.Add(location,0,0); row.Controls.Add(browse,1,0); layout.Controls.Add(row,0,2);
        layout.Controls.Add(new Label {Text="覆盖同一安装目录会保留“豌豆AI数据”；旧程序备份会保留用于回退。\nAPI 配置和工作台项目仍在 Windows 用户配置目录。网页版使用独立浏览器存储，不共享桌面项目。",Dock=DockStyle.Fill},0,3);
        progress.Dock=DockStyle.Fill;layout.Controls.Add(progress,0,4);status.Dock=DockStyle.Fill;status.Text="选择专用文件夹。安装前请正常保存并关闭已打开的软件。";layout.Controls.Add(status,0,5);install.Text="安装";install.Dock=DockStyle.Right;install.Width=120;layout.Controls.Add(install,0,6);Controls.Add(layout);
        browse.Click += delegate { using(var chooser=new FolderBrowserDialog {Description="选择安装父目录；会在其中使用“豌豆AI工具”文件夹",ShowNewFolderButton=true}) if(chooser.ShowDialog(this)==DialogResult.OK) location.Text=Path.Combine(chooser.SelectedPath,"豌豆AI工具"); };
        install.Click += async delegate { if(install.Tag==null)await RunInstall(); };
        FormClosing += delegate(object sender,FormClosingEventArgs e) { if(running)e.Cancel=true; };
    }
    static string DefaultDirectory()
    {
        try { var old=LocalInstallerCore.PortableProfileDirectory(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"豌豆AI"));if(!String.IsNullOrEmpty(old)&&File.Exists(Path.Combine(old,"豌豆AI工具.exe")))return old; }catch{}
        try { DriveInfo best=null; foreach(var d in DriveInfo.GetDrives()) if(d.IsReady&&d.DriveType==DriveType.Fixed&&!d.Name.Equals(Path.GetPathRoot(Environment.SystemDirectory),StringComparison.OrdinalIgnoreCase)&&(best==null||d.AvailableFreeSpace>best.AvailableFreeSpace))best=d; if(best!=null)return Path.Combine(best.RootDirectory.FullName,"豌豆AI工具"); } catch{}
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"Apps","豌豆AI工具");
    }
    async Task RunInstall()
    {
        running=true;install.Enabled=browse.Enabled=location.Enabled=false;var target=location.Text;status.Text="正在检查安装包和目标目录…";
        try
        {
            var backup=await Task.Run(()=>{
                LocalInstallerCore.VerifyPortableProfile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"豌豆AI"),target);
                using(var input=Assembly.GetExecutingAssembly().GetManifestResourceStream("wandou.package.zip"))
                {
                    if(input==null)throw new IOException("安装包资源缺失。");
                    using(var hash=SHA256.Create())if(BitConverter.ToString(hash.ComputeHash(input)).Replace("-","").ToLowerInvariant()!=InstallBuild.Sha256)throw new IOException("安装包完整性校验失败，请重新获取完整安装包。");
                    input.Position=0;
                    return LocalInstallerCore.Install(input,target,InstallBuild.Version,p=>BeginInvoke(new Action(()=>{progress.Value=p;status.Text="正在安装… "+p+"%";})),p=>LocalInstallerCore.CreateShortcuts(p,Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"豌豆AI工具")),null,null);
                }
            });
            status.Text="安装完成。桌面和开始菜单均已创建快捷方式。"+(backup.Length>0?"\n旧程序备份："+backup:"");install.Text="打开软件";install.Enabled=true;
            // The completed window becomes a launch action; no automatic paid/network operation.
            install.Click += delegate { try { Process.Start(new ProcessStartInfo(Path.Combine(target,"豌豆AI工具.exe")){WorkingDirectory=target,UseShellExecute=true}); Close(); }catch(Exception e){MessageBox.Show(this,e.Message,"无法启动");} };
            install.Tag="done";
        }
        catch(Exception ex){status.Text="安装未完成："+ex.Message;install.Enabled=browse.Enabled=location.Enabled=true;}
        finally {running=false;}
    }
    [STAThread] static void Main() { LocalInstallerCore.EnableLongPaths();Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new InstallerWindow()); }
}
