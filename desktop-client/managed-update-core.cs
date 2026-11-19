using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

// Shared by setup and protocol-2 updater. Unknown files are never owned merely
// because they happen to be inside a program directory.
public static class ManagedUpdateCore
{
    public const string ManifestName = ".wandou-program-manifest.json";
    public class Baseline { public string version; public Dictionary<string,string> files; }
    public class Manifest { public int schemaVersion; public string version; public Dictionary<string,string> files; public Baseline[] baselines; }
    public class Journal { public int schemaVersion=1; public string target; public string backup; public string state; public Dictionary<string,string> oldFiles; public Dictionary<string,string> newFiles; public List<string> backedUp=new List<string>(); public List<string> installed=new List<string>(); }
    static readonly StringComparer Names=StringComparer.OrdinalIgnoreCase;
    static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength=8*1024*1024, RecursionLimit=30 }; }
    public static string Hash(string file) { using(var s=File.OpenRead(file))using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(s)).Replace("-","").ToLowerInvariant(); }
    public static string BackupPrefix(string target){using(var h=SHA256.Create()){var key=BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(target).TrimEnd('\\').ToLowerInvariant()))).Replace("-","").ToLowerInvariant();return ".wandou-program-backup-"+key.Substring(0,12)+"-";}}
    static bool Exists(string file) { return File.Exists(file)||Directory.Exists(file); }
    public static void NoLinks(string file)
    {
        for(var p=Path.GetFullPath(file);!String.IsNullOrEmpty(p);p=Path.GetDirectoryName(p))
            if(Exists(p)&&(File.GetAttributes(p)&FileAttributes.ReparsePoint)!=0)throw new IOException("程序路径含链接，已停止更新。");
    }
    public static void SafeName(string name)
    {
        if(String.IsNullOrEmpty(name)||name.Length>220||name.IndexOf('\\')>=0||name.StartsWith("/")||name.EndsWith("/"))throw new IOException("程序清单路径无效。");
        var parts=name.Split('/');
        if(parts[0]!=ManifestName&&!Array.Exists(new[]{"豌豆AI工具.exe","程序文件","resources","网页版.html","使用说明.txt"},p=>Names.Equals(p,parts[0])))throw new IOException("程序清单包含非程序文件。");
        foreach(var part in parts)
        {
            if(String.IsNullOrEmpty(part)||part=="."||part==".."||part.EndsWith(".")||part.EndsWith(" ")||part.IndexOfAny(Path.GetInvalidFileNameChars())>=0||Regex.IsMatch(part,@"^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)",RegexOptions.IgnoreCase))throw new IOException("程序清单路径不安全。");
            if(Array.Exists(new[]{"豌豆AI数据","canvas-media","canvas-backups","local-data","export-artifacts","project-storage.json","project-hub-state.json",".wandou-project-storage.json",".wandou-migration-manifest.json"},p=>Names.Equals(p,part))||part.StartsWith(".wandou-project-migration-",StringComparison.OrdinalIgnoreCase))throw new IOException("更新包不能包含项目数据。");
        }
        if(parts.Length>1&&parts[0]!= "程序文件"&&parts[0]!="resources")throw new IOException("程序清单根目录无效。");
    }
    static string At(string root,string name) { SafeName(name);var p=Path.Combine(root,name.Replace('/','\\'));NoLinks(p);return p; }
    static Dictionary<string,string> ValidMap(Dictionary<string,string> input)
    {
        if(input==null||input.Count<1||input.Count>20000)throw new IOException("程序清单缺失或过大。");
        var result=new Dictionary<string,string>(Names);
        foreach(var e in input){SafeName(e.Key);if(e.Key==ManifestName||!Regex.IsMatch(e.Value??"","^[a-f0-9]{64}$")||result.ContainsKey(e.Key))throw new IOException("程序清单重复或校验值无效。");result.Add(e.Key,e.Value);}
        foreach(var k in result.Keys){var p=k;while(p.Contains("/")){p=p.Substring(0,p.LastIndexOf('/'));if(result.ContainsKey(p))throw new IOException("程序清单文件与目录冲突。");}}
        return result;
    }
    public static Manifest ReadManifest(string root)
    {
        var file=At(root,ManifestName);if(!File.Exists(file)||new FileInfo(file).Length>8*1024*1024)throw new IOException("缺少安全更新清单，请使用新版安装包。");
        var m=Serializer().Deserialize<Manifest>(File.ReadAllText(file));
        if(m==null||m.schemaVersion!=1||!Regex.IsMatch(m.version??"",@"^\d+\.\d+\.\d+$"))throw new IOException("安全更新清单版本无效。");
        m.files=ValidMap(m.files);return m;
    }
    public static Manifest VerifyStage(string stage,string version)
    {
        var m=ReadManifest(stage);if(m.version!=version)throw new IOException("清单与目标版本不一致。");
        var found=new HashSet<string>(Names);
        foreach(var file in Directory.GetFiles(stage,"*",SearchOption.AllDirectories)) { var rel=file.Substring(stage.TrimEnd('\\').Length+1).Replace('\\','/');NoLinks(file);if(rel==ManifestName)continue;string hash;if(!m.files.TryGetValue(rel,out hash)||Hash(file)!=hash)throw new IOException("更新文件与安全清单不一致。");found.Add(rel); }
        if(found.Count!=m.files.Count)throw new IOException("安全清单文件不完整。");
        foreach(var rel in new[]{"resources/app/VERSION.txt","程序文件/resources/app/VERSION.txt"})if(!m.files.ContainsKey(rel)||File.ReadAllLines(At(stage,rel))[0].Trim().TrimStart('v')!=version)throw new IOException("包内版本与目标版本不一致。");
        foreach(var rel in new[]{"豌豆AI工具.exe","程序文件/豌豆AI工具.exe","程序文件/resources/app/index.html"})if(!m.files.ContainsKey(rel))throw new IOException("安全包缺少必要文件。");
        return m;
    }
    public static void ValidateArchive(ZipArchive archive)
    {
        var names=new HashSet<string>(Names);long total=0;
        foreach(var e in archive.Entries){var name=e.FullName.Replace('\\','/');if(name.EndsWith("/"))name=name.TrimEnd('/');SafeName(name);if(!names.Add(name)||((e.ExternalAttributes>>16)&0xF000)==0xA000||(e.ExternalAttributes&0x400)!=0)throw new IOException("更新包含重复路径或链接。");total=checked(total+e.Length);if(total>8L*1024*1024*1024||archive.Entries.Count>20000)throw new IOException("更新包超过安全大小限制。");}
        if(!names.Contains(ManifestName))throw new IOException("缺少协议 2 程序清单，请手动安装安全版本。");
    }
    static Dictionary<string,string> OldFiles(string target,Manifest incoming)
    {
        if(File.Exists(At(target,ManifestName)))return ReadManifest(target).files;
        if(!File.Exists(At(target,"豌豆AI工具.exe")))return new Dictionary<string,string>(Names);
        foreach(var b in incoming.baselines??new Baseline[0])
        {
            var map=ValidMap(b.files);bool match=true;
            foreach(var e in map){var file=At(target,e.Key);if(!File.Exists(file)||Hash(file)!=e.Value){match=false;break;}}
            if(match)return map;
        }
        throw new IOException("旧程序无法与已验证版本匹配，已保留全部文件。请备份后使用独立新目录安装。");
    }
    public static void Preflight(string stage,string target,string version)
    {
        NoLinks(target);var incoming=VerifyStage(stage,version);var old=OldFiles(target,incoming);
        var all=new HashSet<string>(old.Keys,Names);all.UnionWith(incoming.files.Keys);all.Add(ManifestName);
        foreach(var key in all){var relative=key.Replace('/','\\');var parent=Path.GetDirectoryName(target);if(Path.Combine(target,relative).Length>240||Path.Combine(parent,".wandou-program-stage-"+new String('a',32),relative).Length>240||Path.Combine(parent,BackupPrefix(target)+new String('a',32),"files",relative).Length>240)throw new IOException("目录过深，无法为安全更新与回退保留路径余量；尚未修改程序。");}
        foreach(var e in old){var file=At(target,e.Key);if(!File.Exists(file)||Hash(file)!=e.Value)throw new IOException("已安装程序文件发生变化，已停止覆盖。");}
        foreach(var e in incoming.files){var file=At(target,e.Key);if(Directory.Exists(file)||(File.Exists(file)&&!old.ContainsKey(e.Key)))throw new IOException("新程序与自建文件冲突，已停止覆盖并保留原文件。");var parent=Path.GetDirectoryName(file);while(!Names.Equals(parent,target)){if(File.Exists(parent))throw new IOException("新程序目录与自建文件冲突。");parent=Path.GetDirectoryName(parent);}}
    }
    static void WriteJournal(string backup,Journal journal)
    {
        string dest=Path.Combine(backup,"transaction.receipt"),tmp=dest+".new";
        var json=Encoding.UTF8.GetBytes(Serializer().Serialize(journal));
        var bytes=ProtectedData.Protect(json,Encoding.UTF8.GetBytes("Wandou-managed-update-protocol-2"),DataProtectionScope.CurrentUser);
        using(var stream=new FileStream(tmp,FileMode.Create,FileAccess.Write,FileShare.None)){stream.Write(bytes,0,bytes.Length);stream.Flush(true);}
        if(File.Exists(dest))File.Replace(tmp,dest,null);else File.Move(tmp,dest);
        // Human-readable diagnostics never authorize recovery. A forged JSON
        // file cannot become a deletion plan; only our sealed receipt is read.
        try{File.WriteAllBytes(Path.Combine(backup,"transaction.json"),json);}catch{}
    }
    static Journal ReadJournal(string backup)
    {
        NoLinks(backup);var file=Path.Combine(backup,"transaction.receipt");NoLinks(file);
        if(!File.Exists(file)||new FileInfo(file).Length>9*1024*1024)throw new IOException("缺少完整的安全事务凭据，已保留文件，请使用已验证的备份恢复。");
        var bytes=ProtectedData.Unprotect(File.ReadAllBytes(file),Encoding.UTF8.GetBytes("Wandou-managed-update-protocol-2"),DataProtectionScope.CurrentUser);
        var j=Serializer().Deserialize<Journal>(Encoding.UTF8.GetString(bytes));
        if(j==null||j.schemaVersion!=1||!Names.Equals(j.backup,Path.GetFullPath(backup))||String.IsNullOrEmpty(j.target)||!Path.IsPathRooted(j.target)||!Array.Exists(new[]{"applying","committed","rolled-back"},s=>s==j.state)||j.oldFiles==null||j.newFiles==null||j.backedUp==null||j.installed==null||j.oldFiles.Count>20001||j.newFiles.Count>20001)throw new IOException("事务凭据无效。");
        foreach(var map in new[]{j.oldFiles,j.newFiles}){var names=new HashSet<string>(Names);foreach(var e in map){SafeName(e.Key);if(!names.Add(e.Key)||!Regex.IsMatch(e.Value??"","^[a-f0-9]{64}$"))throw new IOException("事务文件清单无效。");}}
        foreach(var pair in new[]{new KeyValuePair<List<string>,Dictionary<string,string>>(j.backedUp,j.oldFiles),new KeyValuePair<List<string>,Dictionary<string,string>>(j.installed,j.newFiles)}){var names=new HashSet<string>(Names);if(pair.Key.Count>20001)throw new IOException("事务步骤过多。");foreach(var key in pair.Key)if(!pair.Value.ContainsKey(key)||!names.Add(key))throw new IOException("事务步骤无效。");}
        return j;
    }
    static void Move(string from,string to){NoLinks(from);NoLinks(to);Directory.CreateDirectory(Path.GetDirectoryName(to));File.Move(from,to);}
    static void Rollback(string backup,Journal j,Action<string> progress=null)
    {
        // Verify the complete plan before removing anything. Restored old bytes
        // are recognized even when old/new SHA are equal, making replay safe.
        var installed=new HashSet<string>(j.installed,Names);
        foreach(var key in j.backedUp){var saved=At(Path.Combine(backup,"files"),key);var file=At(j.target,key);if(Directory.Exists(file))throw new IOException("回退目标被替换为目录。");if(File.Exists(saved)){if(Hash(saved)!=j.oldFiles[key])throw new IOException("回退备份校验失败。");}else if(!File.Exists(file)||Hash(file)!=j.oldFiles[key])throw new IOException("回退备份不完整。");if(File.Exists(file)){var actual=Hash(file);string next;if(actual!=j.oldFiles[key]&&(!installed.Contains(key)||!j.newFiles.TryGetValue(key,out next)||actual!=next))throw new IOException("回退目标含人工修改，尚未删除任何程序文件。");}}
        foreach(var key in j.installed){var file=At(j.target,key);if(Directory.Exists(file))throw new IOException("回退目标被替换为目录。");if(!File.Exists(file))continue;var actual=Hash(file);string old;if(actual!=j.newFiles[key]&&(!j.oldFiles.TryGetValue(key,out old)||actual!=old))throw new IOException("回退检测到文件被修改，请保留事务备份。");}
        for(int i=j.installed.Count-1;i>=0;i--){var key=j.installed[i];var file=At(j.target,key);if(!File.Exists(file))continue;string old;var actual=Hash(file);if(j.oldFiles.TryGetValue(key,out old)&&actual==old)continue;if(actual!=j.newFiles[key])throw new IOException("回退时检测到文件被修改。");File.Delete(file);}
        for(int i=j.backedUp.Count-1;i>=0;i--){var key=j.backedUp[i];var saved=At(Path.Combine(backup,"files"),key);var file=At(j.target,key);if(!File.Exists(file)||Hash(file)!=j.oldFiles[key]){Directory.CreateDirectory(Path.GetDirectoryName(file));var copy=Path.Combine(backup,".restore-"+Guid.NewGuid().ToString("N"));using(var input=File.OpenRead(saved))using(var output=new FileStream(copy,FileMode.CreateNew,FileAccess.Write,FileShare.None)){input.CopyTo(output);output.Flush(true);}if(Hash(copy)!=j.oldFiles[key])throw new IOException("回退文件校验失败。");Move(copy,file);}if(progress!=null)progress("restored:"+key);}
        j.state="rolled-back";WriteJournal(backup,j);
    }
    // Recovery is deliberately explicit and limited to our own journal format.
    // Old .previous-* directories are never inspected, cleaned or deleted.
    public static void Recover(string target){Recover(target,null);}
    public static void Recover(string target,Action<string> progress)
    {
        target=Path.GetFullPath(target).TrimEnd('\\');NoLinks(target);var parent=Path.GetDirectoryName(target);if(!Directory.Exists(parent))return;
        foreach(var backup in Directory.GetDirectories(parent,BackupPrefix(target)+"*"))
        {
            var j=ReadJournal(backup);if(!Names.Equals(j.target,target)||j.state!="applying")continue;
            Rollback(backup,j,progress);
        }
    }
    public static string Apply(string stage,string target,string version,Action<string> fault,Action beforeCommit)
    {
        target=Path.GetFullPath(target).TrimEnd('\\');Preflight(stage,target,version);var next=ReadManifest(stage);var old=OldFiles(target,next);
        long rollbackBytes=0;foreach(var key in old.Keys)rollbackBytes=checked(rollbackBytes+new FileInfo(At(target,key)).Length);
        if(new DriveInfo(Path.GetPathRoot(target)).AvailableFreeSpace<rollbackBytes+256L*1024*1024)throw new IOException("磁盘空间不足以保留可恢复的旧程序，已停止更新。");
        var backup=Path.Combine(Path.GetDirectoryName(target),BackupPrefix(target)+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(backup);Directory.CreateDirectory(target);
        var j=new Journal{target=target,backup=backup,state="applying",oldFiles=new Dictionary<string,string>(old,Names),newFiles=new Dictionary<string,string>(next.files,Names)};
        if(File.Exists(At(target,ManifestName)))j.oldFiles[ManifestName]=Hash(At(target,ManifestName));j.newFiles[ManifestName]=Hash(At(stage,ManifestName));WriteJournal(backup,j);
        try
        {
            foreach(var e in j.oldFiles){j.backedUp.Add(e.Key);WriteJournal(backup,j);Move(At(target,e.Key),At(Path.Combine(backup,"files"),e.Key));}
            if(fault!=null)fault("backed-up");
            foreach(var e in j.newFiles){j.installed.Add(e.Key);WriteJournal(backup,j);Move(At(stage,e.Key),At(target,e.Key));if(fault!=null)fault("installed:"+e.Key);}
            VerifyStageFiles(target,next);if(beforeCommit!=null)beforeCommit();j.state="committed";WriteJournal(backup,j);
            try{File.SetAttributes(At(target,ManifestName),FileAttributes.Hidden);File.SetAttributes(backup,File.GetAttributes(backup)|FileAttributes.Hidden);}catch{}
            return backup;
        }
        catch { Rollback(backup,j);throw; }
    }
    public static void RevertCommitted(string backup,string target)
    {
        var j=ReadJournal(backup);
        if(j==null||j.schemaVersion!=1||j.state!="committed"||!Names.Equals(j.target,Path.GetFullPath(target).TrimEnd('\\')))throw new IOException("回退事务不匹配。");
        j.state="applying";WriteJournal(backup,j);Rollback(backup,j);
    }
    static void VerifyStageFiles(string target,Manifest next){foreach(var e in next.files)if(Hash(At(target,e.Key))!=e.Value)throw new IOException("已安装文件校验失败。");}
}
