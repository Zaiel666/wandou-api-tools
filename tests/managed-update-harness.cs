using System;
using System.IO;
using System.IO.Compression;
using System.Threading;
internal static class ManagedUpdateHarness
{
    public static int Main(string[] args)
    {
        try
        {
            switch(args[0])
            {
                case "zip":ZipFile.CreateFromDirectory(args[1],args[2]);break;
                case "validate":using(var zip=ZipFile.OpenRead(args[1]))ManagedUpdateCore.ValidateArchive(zip);break;
                case "recover":ManagedUpdateCore.Recover(args[1]);break;
                case "recover-crash":ManagedUpdateCore.Recover(args[1],step=>{if(step==args[2])Environment.Exit(24);});break;
                case "preflight":ManagedUpdateCore.Preflight(args[1],args[2],args[3]);break;
                case "apply":
                    var backup=ManagedUpdateCore.Apply(args[1],args[2],args[3],step=>{
                        if(args.Length>4&&args[4]==step)throw new IOException("Synthetic disk failure");
                        if(args.Length>4&&args[4]=="crash:"+step)Environment.Exit(23);
                    },()=>{if(args.Length>4&&args[4]=="commit-failure")throw new IOException("Synthetic final verification failure");});
                    Console.WriteLine(backup);break;
                case "revert":ManagedUpdateCore.RevertCommitted(args[1],args[2]);break;
                case "malformed-zip":
                    using(var zip=ZipFile.Open(args[1],ZipArchiveMode.Update))
                    {var entry=zip.CreateEntry(args[2]);if(args.Length>3&&args[3]=="symlink")entry.ExternalAttributes=unchecked((int)0xA1FF0000);using(var w=new StreamWriter(entry.Open()))w.Write("invalid");}break;
                default:throw new Exception("Unknown scenario");
            }
            return 0;
        }
        catch(Exception e){Console.Error.WriteLine(e.GetType().Name+": "+e.Message);return 1;}
    }
}
