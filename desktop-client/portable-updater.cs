using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Threading;

internal static class PortableUpdater
{
    static string Arg(string[] args, string name)
    {
        for (var i = 0; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
        return "";
    }

    static void Log(string path, string message)
    {
        try { File.AppendAllText(path, DateTime.UtcNow.ToString("u") + " " + message + Environment.NewLine); } catch { }
    }

    static void CopyDirectory(string from, string to)
    {
        foreach (var directory in Directory.GetDirectories(from, "*", SearchOption.AllDirectories))
            Directory.CreateDirectory(directory.Replace(from, to));
        foreach (var file in Directory.GetFiles(from, "*", SearchOption.AllDirectories))
        {
            var destination = file.Replace(from, to);
            Directory.CreateDirectory(Path.GetDirectoryName(destination));
            try { File.Copy(file, destination, true); }
            catch (Exception ex) { throw new IOException("Failed to replace " + destination + ": " + ex.Message, ex); }
        }
    }

    static void StopInstallProcesses(string install, string executable, string log)
    {
        var name = Path.GetFileNameWithoutExtension(executable);
        for (var round = 0; round < 8; round++)
        {
            var found = false;
            foreach (var process in Process.GetProcessesByName(name))
            {
                try
                {
                    var processPath = process.MainModule.FileName;
                    if (!processPath.StartsWith(install, StringComparison.OrdinalIgnoreCase)) continue;
                    found = true;
                    process.Kill();
                    process.WaitForExit(5000);
                }
                catch { }
                finally { process.Dispose(); }
            }
            if (!found) return;
            Thread.Sleep(500);
        }
        Log(log, "Warning: some application processes may still be running before copy.");
    }

    public static int Main(string[] args)
    {
        var install = Arg(args, "--install");
        var package = Arg(args, "--package");
        var executable = Arg(args, "--exe");
        var ready = Arg(args, "--ready");
        var target = Arg(args, "--target").TrimStart('v');
        int parent;
        int.TryParse(Arg(args, "--parent"), out parent);
        var log = Path.Combine(install, "wandou-ai-update.log");
        var stage = Path.Combine(Path.GetTempPath(), "wandou-ai-stage-" + Guid.NewGuid().ToString("N"));

        try
        {
            if (String.IsNullOrWhiteSpace(install) || !Directory.Exists(install) || !File.Exists(package)) throw new InvalidOperationException("Invalid update arguments.");
            File.WriteAllText(ready, "ready");
            Log(log, "Native updater accepted update request.");
            // Kill the tree while the parent PID still exists. Waiting for the parent first
            // reparents Electron renderer/GPU children and leaves app.asar memory-mapped.
            Thread.Sleep(1800);
            try { Process.Start(new ProcessStartInfo("taskkill", "/PID " + parent + " /T /F") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit(15000); } catch { }
            StopInstallProcesses(install, executable, log);
            Thread.Sleep(1000);
            Directory.CreateDirectory(stage);
            ZipFile.ExtractToDirectory(package, stage);
            Exception last = null;
            for (var attempt = 0; attempt < 30; attempt++)
            {
                try { CopyDirectory(stage, install); last = null; break; }
                catch (Exception ex) { last = ex; Log(log, "Native copy attempt " + (attempt + 1) + " failed: " + ex.Message); Thread.Sleep(1000); }
            }
            if (last != null) throw last;
            if (!String.IsNullOrWhiteSpace(target))
            {
                var versionFile = Path.Combine(install, "resources", "app", "VERSION.txt");
                if (!File.Exists(versionFile) || File.ReadAllLines(versionFile)[0].Trim().TrimStart('v') != target)
                    throw new InvalidOperationException("Installed version verification failed.");
            }
            Log(log, "Native update completed. Restarting application.");
            Process.Start(new ProcessStartInfo(Path.Combine(install, executable)) { WorkingDirectory = install, UseShellExecute = true });
            return 0;
        }
        catch (Exception ex)
        {
            Log(log, "Native update failed: " + ex.Message);
            try { Process.Start(new ProcessStartInfo(Path.Combine(install, executable)) { WorkingDirectory = install, UseShellExecute = true }); } catch { }
            return 1;
        }
        finally { try { Directory.Delete(stage, true); } catch { } }
    }
}
