using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

internal static class PortableUpdater
{
    static string Arg(string[] args,string key){for(int i=0;i+1<args.Length;i++)if(args[i]==key)return args[i+1];return "";}
    static void Log(string file,string message){try{File.AppendAllText(file,DateTime.UtcNow.ToString("u")+" "+message+Environment.NewLine);}catch{}}
    static void ErrorReceipt(string ready,string phase)
    {
        string message;
        switch(phase){case "preflight":message="程序文件被修改、目录过深或与自建文件冲突。已停止自动更新，请保留文件并使用安装包。";break;case "installed-manifest":message="当前程序不支持安全自动更新，请先使用新版安装包覆盖原目录。";break;case "package-sha":case "archive-validation":message="更新包校验失败或磁盘空间不足，已停止安装。";break;case "parent-identity":case "parent-exit":message="软件未能正常保存退出，已停止更新。";break;case "commit":message="更新未获最终保存确认或已取消，原程序未修改。";break;case "restart":message="新版本未能启动，请保留事务备份并使用安装包恢复。";break;case "transaction":message="程序更新未完成，请保留事务备份。若无法启动，请使用安装包恢复。";break;default:message="安全更新参数无效，请使用新版安装包。";break;}
        try{if(Path.IsPathRooted(ready)){ManagedUpdateCore.NoLinks(ready+".error.json");using(var f=new FileStream(ready+".error.json",FileMode.CreateNew,FileAccess.Write,FileShare.Read)){var bytes=Encoding.UTF8.GetBytes(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new{phase=phase,message=message}));f.Write(bytes,0,bytes.Length);f.Flush(true);}}}catch{}
    }
    static Process OpenParent(int pid,string install)
    {
        if(pid<=0)throw new IOException("Missing requesting process.");
        Process parent;
        try{parent=Process.GetProcessById(pid);}catch(ArgumentException){throw new IOException("Requesting process is no longer available.");}
        try{var exe=Path.GetFullPath(parent.MainModule.FileName);if(!exe.StartsWith(install+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new IOException("Requesting process does not belong to this installation.");var retainedHandle=parent.Handle;return parent;}catch{parent.Dispose();throw;}
    }
    static void CheckRunning(string install)
    {
        // Electron child processes may finish shortly after the browser process.
        // Give them time to exit normally, without killing unrelated programs.
        for(int attempt=0;attempt<40;attempt++)
        {
            bool found=false;
            foreach(var p in Process.GetProcessesByName("豌豆AI工具"))using(p){if(p.Id==Process.GetCurrentProcess().Id)continue;string name;try{name=p.MainModule.FileName;}catch{continue;}if(Path.GetFullPath(name).StartsWith(install+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))found=true;}
            if(!found)return;Thread.Sleep(250);
        }
        throw new IOException("Another application process is still running.");
    }
    static void AwaitCommit(Process parent,string ready)
    {
        string commit=ready+".commit",cancel=ready+".cancel";
        for(int attempt=0;attempt<1200;attempt++)
        {
            ManagedUpdateCore.NoLinks(commit);ManagedUpdateCore.NoLinks(cancel);
            if(File.Exists(cancel))throw new IOException("Update cancelled before commit; original files are unchanged.");
            if(File.Exists(commit))
            {
                if(new FileInfo(commit).Length!=6||File.ReadAllText(commit)!="commit")throw new IOException("Invalid update commit receipt.");
                if(File.Exists(cancel)||(parent.HasExited&&File.GetLastWriteTimeUtc(commit)>parent.ExitTime.ToUniversalTime()))throw new IOException("Update was cancelled.");
                return;
            }
            if(parent.HasExited)throw new IOException("Requesting process closed before commit.");
            Thread.Sleep(100);
        }
        throw new IOException("Update commit timed out; original files are unchanged.");
    }
    static bool Start(string install,string executable)
    {
        // Observe the real runtime, not the compatibility launcher which stays
        // alive for three seconds even when its Electron child already failed.
        var runtime=Path.Combine(install,"程序文件");
        using(var p=Process.Start(new ProcessStartInfo(Path.Combine(runtime,executable)){WorkingDirectory=runtime,UseShellExecute=false})){if(p==null)return false;Thread.Sleep(1500);return !p.HasExited;}
    }
    static void ValidateUpdatePackage(string package){using(var zip=ZipFile.OpenRead(package))ManagedUpdateCore.ValidateArchive(zip);}
    public static int Main(string[] args)
    {
        string install=Arg(args,"--install"),package=Arg(args,"--package"),version=Arg(args,"--target"),exe=Arg(args,"--exe"),ready=Arg(args,"--ready"),expected=Arg(args,"--sha256").ToLowerInvariant();
        string stage=null,log=null,phase="arguments";bool parentClosed=false;
        try
        {
            if(Arg(args,"--protocol")!="2"||!Regex.IsMatch(expected,"^[a-f0-9]{64}$")||!Regex.IsMatch(version,@"^\d+\.\d+\.\d+$")||exe!="豌豆AI工具.exe"||!Path.IsPathRooted(install)||!Path.IsPathRooted(package)||!Path.IsPathRooted(ready))throw new IOException("Invalid safe-update arguments. Use the setup installer to transition from older versions.");
            install=Path.GetFullPath(install).TrimEnd('\\');if(install.Length<4||!Directory.Exists(install))throw new IOException("Invalid installation directory.");ManagedUpdateCore.NoLinks(install);ManagedUpdateCore.NoLinks(package);ManagedUpdateCore.NoLinks(ready);
            log=Path.Combine(Path.GetDirectoryName(package),"update.log");
            string key;using(var hash=SHA256.Create())key=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(install.ToLowerInvariant()))).Replace("-","");
            using(var gate=new Mutex(false,@"Local\WandouInstall-"+key))
            {
                bool held=false;
                try
                {
                    try{held=gate.WaitOne(0);}catch(AbandonedMutexException){held=true;}if(!held)throw new IOException("An installation is already in progress.");
                    phase="installed-manifest";var old=ManagedUpdateCore.ReadManifest(install);if(new Version(version)<=new Version(old.version))throw new IOException("Downgrade or repeated update refused.");
                    // Holding the ZIP open without write/delete sharing prevents a
                    // different package being substituted after checksum validation.
                    using(var input=new FileStream(package,FileMode.Open,FileAccess.Read,FileShare.Read))
                    {
                        phase="package-sha";using(var hash=SHA256.Create())if(BitConverter.ToString(hash.ComputeHash(input)).Replace("-","").ToLowerInvariant()!=expected)throw new IOException("Package checksum mismatch.");input.Position=0;
                        using(var zip=new ZipArchive(input,ZipArchiveMode.Read,true))
                        {
                            phase="archive-validation";ManagedUpdateCore.ValidateArchive(zip);
                            long bytes=0;foreach(var entry in zip.Entries)bytes=checked(bytes+entry.Length);
                            if(new DriveInfo(Path.GetPathRoot(install)).AvailableFreeSpace<bytes+256L*1024*1024)throw new IOException("Not enough free space; original files are unchanged.");
                            stage=Path.Combine(Path.GetDirectoryName(install),".wandou-program-stage-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(stage);
                            foreach(var entry in zip.Entries){var file=Path.Combine(stage,entry.FullName.Replace('/','\\'));if(file.Length>240)throw new IOException("Update path is too deep.");if(entry.FullName.EndsWith("/")||entry.FullName.EndsWith("\\")){Directory.CreateDirectory(file);continue;}Directory.CreateDirectory(Path.GetDirectoryName(file));using(var source=entry.Open())using(var output=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None)){source.CopyTo(output);output.Flush(true);}}
                        }
                        phase="preflight";ManagedUpdateCore.Preflight(stage,install,version);
                        int pid;if(!Int32.TryParse(Arg(args,"--parent"),out pid)||pid<=0)throw new IOException("Invalid requesting process.");
                        phase="parent-identity";
                        using(var requesting=OpenParent(pid,install))
                        {
                            // Retain the verified process handle across readiness,
                            // so a missing/reused PID cannot authorize shutdown.
                            if(File.Exists(ready+".commit")||File.Exists(ready+".cancel"))throw new IOException("Stale update handshake files.");
                            using(var output=new FileStream(ready,FileMode.CreateNew,FileAccess.Write,FileShare.Read)){var data=Encoding.ASCII.GetBytes("ready");output.Write(data,0,data.Length);output.Flush(true);}
                            phase="commit";AwaitCommit(requesting,ready);
                            phase="parent-exit";if(!requesting.WaitForExit(30000))throw new IOException("Application did not close normally. No files were changed.");
                        }
                        if(File.Exists(ready+".cancel"))throw new IOException("Update was cancelled after commit.");
                        parentClosed=true;CheckRunning(install);
                        phase="transaction";var backup=ManagedUpdateCore.Apply(stage,install,version,null,null);
                        phase="restart";try{if(!Start(install,exe))throw new IOException("New application failed to start.");}
                        catch{ManagedUpdateCore.RevertCommitted(backup,install);throw;}
                        Log(log,"Safe update committed; previous program backup retained. Unknown files were not removed.");return 0;
                    }
                }
                finally{if(held)gate.ReleaseMutex();}
            }
        }
        catch(Exception error){ErrorReceipt(ready,phase);Log(log??Path.Combine(Path.GetTempPath(),"wandou-safe-update-error.log"),"Safe update stopped at "+phase+" ("+error.GetType().Name+"). Original data and retained backups were not cleaned.");if(parentClosed)try{Start(install,exe);}catch{}return 1;}
        finally
        {
            // Delete only the fresh stage created by this invocation, never scan
            // previous installations or an unknown directory for garbage.
            if(stage!=null&&Directory.Exists(stage))try{ManagedUpdateCore.NoLinks(stage);Directory.Delete(stage,true);}catch{}
        }
    }
}
