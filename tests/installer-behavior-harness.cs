using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Reflection;
using System.Threading;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
internal static class InstallBuild { public const string Version="2.0.19"; public const string Sha256="synthetic"; }
internal static class InstallerBehaviorTests
{
    static void Assert(bool value,string message){if(!value)throw new Exception(message);}
    static string HashText(string text){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
    static MemoryStream Zip(string extra)
    {
        var stream=new MemoryStream();
        using(var archive=new ZipArchive(stream,ZipArchiveMode.Create,true))
        {
            var files=new Dictionary<string,string>();
            foreach(var name in new[]{"豌豆AI工具.exe","程序文件/豌豆AI工具.exe","程序文件/resources/app/VERSION.txt","程序文件/resources/app/index.html","resources/app/VERSION.txt","网页版.html","使用说明.txt"})
            {var content=name.EndsWith("VERSION.txt")?"v2.0.19":"new:"+name;files[name]=HashText(content);using(var writer=new StreamWriter(archive.CreateEntry(name).Open()))writer.Write(content);}
            if(extra!=null){var item=archive.CreateEntry(extra=="SYMLINK"?"程序文件/linked-file":extra);if(extra=="SYMLINK")item.ExternalAttributes=unchecked((int)0xA1FF0000);using(var writer=new StreamWriter(item.Open()))writer.Write("extra");}
            using(var writer=new StreamWriter(archive.CreateEntry(ManagedUpdateCore.ManifestName).Open()))writer.Write(new JavaScriptSerializer().Serialize(new{schemaVersion=1,version="2.0.19",files=files,baselines=new[]{new{version="2.0.18",files=new Dictionary<string,string>{{"豌豆AI工具.exe",HashText("old-launcher")},{"程序文件/old.txt",HashText("old-runtime")}}}}}));
        }
        stream.Position=0;return stream;
    }
    static string Install(string target,Action<string> fault=null,long space=Int64.MaxValue,string extra=null,Action<string> shortcut=null)
    {using(var zip=Zip(extra))return LocalInstallerCore.Install(zip,target,"2.0.19",null,shortcut,()=>space,step=>{Console.WriteLine(step);if(fault!=null)fault(step);});}
    static void Rejected(Action action,string message){bool failed=false;try{action();}catch{failed=true;}Assert(failed,message);}
    static void Seed(string target)
    {
        Directory.CreateDirectory(target);Directory.CreateDirectory(Path.Combine(target,"程序文件"));
        File.WriteAllText(Path.Combine(target,"豌豆AI工具.exe"),"old-launcher");File.WriteAllText(Path.Combine(target,"程序文件","old.txt"),"old-runtime");
        File.WriteAllText(Path.Combine(target,"程序文件","my-custom.txt"),"nested-personal");
        Directory.CreateDirectory(Path.Combine(target,"豌豆AI数据"));File.WriteAllText(Path.Combine(target,"豌豆AI数据","project.data"),"original-project");File.WriteAllText(Path.Combine(target,"my-notes.txt"),"personal");
    }
    public static int Main(string[] args)
    {
        if(args[0]=="sleep"){Thread.Sleep(15000);return 0;}
        LocalInstallerCore.EnableLongPaths();string root=args[1],target=Path.Combine(root,"中文安装路径","豌豆 AI 测试程序");Directory.CreateDirectory(root);
        try
        {
            switch(args[0])
            {
            case "make-zip":using(var synthetic=Zip(null))using(var output=File.Create(Path.Combine(root,"package.zip")))synthetic.CopyTo(output);break;
            case "fresh":
                Install(target);Assert(File.ReadAllText(Path.Combine(target,"resources","app","VERSION.txt"))=="v2.0.19","version");Assert(!Directory.Exists(Path.Combine(target,"豌豆AI数据")),"installer must not create/mutate data");break;
            case "preserve":
                Seed(target);string backup=Install(target);Assert(File.ReadAllText(Path.Combine(target,"豌豆AI数据","project.data"))=="original-project","data lost");Assert(File.ReadAllText(Path.Combine(target,"my-notes.txt"))=="personal","unmanaged file changed");Assert(File.ReadAllText(Path.Combine(target,"程序文件","my-custom.txt"))=="nested-personal","nested unmanaged file changed");Assert(File.ReadAllText(Path.Combine(backup,"files","程序文件","old.txt"))=="old-runtime","rollback backup lost");break;
            case "rollback":
                Seed(target);Rejected(()=>Install(target,step=>{if(step.StartsWith("installed:程序文件/"))throw new IOException("simulated power/disk fault");}),"expected fault");Assert(File.ReadAllText(Path.Combine(target,"豌豆AI工具.exe"))=="old-launcher","old launcher not restored");Assert(File.ReadAllText(Path.Combine(target,"程序文件","old.txt"))=="old-runtime","old runtime not restored");Assert(File.ReadAllText(Path.Combine(target,"豌豆AI数据","project.data"))=="original-project","data touched");break;
            case "capacity":Rejected(()=>Install(target,null,0),"space check");Assert(!Directory.Exists(target),"no-space wrote target");break;
            case "malformed":
                foreach(var extra in new[]{"../outside.txt","程序文件/../../outside.txt","豌豆AI数据/project.data","程序文件/canvas-media/original.data","程序文件/resources/app/VERSION.txt","SYMLINK"})Rejected(()=>Install(target,null,Int64.MaxValue,extra),"unsafe archive accepted: "+extra);Assert(!Directory.Exists(target),"unsafe archive wrote target");break;
            case "unknown":Directory.CreateDirectory(target);File.WriteAllText(Path.Combine(target,"valuable.txt"),"keep");Rejected(()=>Install(target),"unrelated directory accepted");Assert(File.ReadAllText(Path.Combine(target,"valuable.txt"))=="keep","unrelated changed");break;
            case "long":
                target=Path.Combine(root,new String('中',60),new String('名',30),"豌豆AI工具");var relative="程序文件/resources/app/"+new String('a',70)+"/"+new String('b',70)+"/原图说明.txt";Rejected(()=>Install(target,null,Int64.MaxValue,relative),"path unsafe for updater accepted");Assert(!Directory.Exists(LocalInstallerCore.Extended(target)),"deep path wrote files before rejection");break;
            case "update-path-margin":
                var syntheticRoot=@"C:\"+new String('中',127)+@"\豌豆AI工具";
                using(var zip=Zip("程序文件/resources/app/"+new String('a',51)+".txt"))using(var archive=new ZipArchive(zip,ZipArchiveMode.Read,true)){long bytes;Assert(Path.Combine(syntheticRoot,archive.Entries[archive.Entries.Count-2].FullName).Length<240,"fixture must fit normal installation path");Rejected(()=>LocalInstallerCore.ValidateArchive(archive,syntheticRoot,out bytes),"updater stage suffix not reserved");}break;
            case "locked":Seed(target);using(var locked=new FileStream(Path.Combine(target,"豌豆AI工具.exe"),FileMode.Open,FileAccess.Read,FileShare.Read))Rejected(()=>Install(target),"locked executable accepted");Assert(File.ReadAllText(Path.Combine(target,"豌豆AI工具.exe"))=="old-launcher","locked update damaged original");break;
            case "shortcuts":
                Install(target,null,Int64.MaxValue,null,p=>LocalInstallerCore.CreateShortcuts(p,Path.Combine(root,"fake-desktop"),Path.Combine(root,"fake-start-menu")));Assert(File.Exists(Path.Combine(root,"fake-desktop","豌豆AI工具.lnk")),"desktop link missing");Assert(File.Exists(Path.Combine(root,"fake-start-menu","豌豆AI工具.lnk")),"menu link missing");break;
            case "shortcut-failure":Seed(target);Rejected(()=>Install(target,null,Int64.MaxValue,null,p=>{throw new IOException("shortcut permission denied");}),"shortcut fail");Assert(File.ReadAllText(Path.Combine(target,"豌豆AI工具.exe"))=="old-launcher","shortcut failure not rolled back");break;
            case "running":
                Seed(target);var child=Path.Combine(target,"程序文件","豌豆AI工具.exe");File.Copy(Assembly.GetExecutingAssembly().Location,child);using(var process=Process.Start(new ProcessStartInfo(child,"sleep"){UseShellExecute=false,CreateNoWindow=true}))try{Thread.Sleep(100);Rejected(()=>Install(target),"running app not blocked");Assert(!process.HasExited,"installer killed process");}finally{process.Kill();process.WaitForExit();}break;
            case "portable-profile":
                var profile=Path.Combine(root,"profile");Directory.CreateDirectory(profile);var old=Path.Combine(root,"old-program");var serializer=new System.Web.Script.Serialization.JavaScriptSerializer();
                File.WriteAllText(Path.Combine(profile,"project-storage.json"),serializer.Serialize(new {version=1,active=new {mode="portable",id="synthetic-id",directory=Path.Combine(old,"豌豆AI数据")}}));
                LocalInstallerCore.VerifyPortableProfile(profile,old);Rejected(()=>LocalInstallerCore.VerifyPortableProfile(profile,target),"portable data silently orphaned");
                Directory.CreateDirectory(Path.Combine(target,"豌豆AI数据"));File.WriteAllText(Path.Combine(target,"豌豆AI数据",".wandou-project-storage.json"),"{\"id\":\"wrong-id\"}");Rejected(()=>LocalInstallerCore.VerifyPortableProfile(profile,target),"wrong data marker accepted");
                File.WriteAllText(Path.Combine(target,"豌豆AI数据",".wandou-project-storage.json"),"{\"id\":\"synthetic-id\"}");LocalInstallerCore.VerifyPortableProfile(profile,target);
                File.WriteAllText(Path.Combine(profile,"project-storage.json"),serializer.Serialize(new {version=1,active=new {mode="custom",id="synthetic-id",directory=Path.Combine(old,"豌豆AI数据")}}));LocalInstallerCore.VerifyPortableProfile(profile,Path.Combine(root,"different-program"));break;
            case "hold":Install(target,step=>{if(step=="extracted"){File.WriteAllText(Path.Combine(root,"locked-ready"),"ready");Thread.Sleep(15000);}});break;
            case "concurrent":
                using(var childProcess=Process.Start(new ProcessStartInfo(Assembly.GetExecutingAssembly().Location,"hold \""+root+"\""){UseShellExecute=false,CreateNoWindow=true}))try{
                    for(int i=0;i<100&&!File.Exists(Path.Combine(root,"locked-ready"));i++)Thread.Sleep(50);Assert(File.Exists(Path.Combine(root,"locked-ready")),"first installer did not hold lock");Rejected(()=>Install(target),"second installer entered same target");
                }finally{childProcess.Kill();childProcess.WaitForExit();}break;
            default:throw new Exception("unknown case");
            }
            Console.WriteLine("PASS "+args[0]);return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error);return 1;}
    }
}

