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
        var installParent = Path.GetDirectoryName(install.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        var log = Path.Combine(installParent, "wandou-ai-update.log");
        var stage = Path.Combine(Path.GetTempPath(), "wandou-ai-stage-" + Guid.NewGuid().ToString("N"));
        var previous = install.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + ".previous-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var failed = install.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + ".failed-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var oldInstallMoved = false;
        var newInstallActivated = false;

        try
        {
            if (String.IsNullOrWhiteSpace(install) || !Directory.Exists(install) || !File.Exists(package)) throw new InvalidOperationException("Invalid update arguments.");
            File.WriteAllText(ready, "ready");
            Log(log, "Native updater accepted update request.");
            // Kill the tree before the old desktop client's delayed quit timer fires, or
            // Electron renderer/GPU children can become orphaned.
            Thread.Sleep(250);
            try { Process.Start(new ProcessStartInfo("taskkill", "/PID " + parent + " /T /F") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit(15000); } catch { }
            // Also stop orphaned instances left by an earlier failed update. Chromium .pak
            // and app.asar files stay memory-mapped while any such process is alive.
            try { Process.Start(new ProcessStartInfo("taskkill", "/IM \"" + executable + "\" /F") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit(15000); } catch { }
            StopInstallProcesses(install, executable, log);
            Thread.Sleep(1000);
            Directory.CreateDirectory(stage);
            ZipFile.ExtractToDirectory(package, stage);
            // Never overwrite Chromium resources in place. Windows can keep .pak and
            // app.asar files memory-mapped briefly after Electron exits, which made the
            // former file-by-file update fail repeatedly. A directory swap changes only
            // directory entries and preserves the complete old install for rollback.
            Directory.Move(install, previous);
            oldInstallMoved = true;
            Directory.Move(stage, install);
            newInstallActivated = true;
            if (!String.IsNullOrWhiteSpace(target))
            {
                var versionFile = Path.Combine(install, "resources", "app", "VERSION.txt");
                if (!File.Exists(versionFile) || File.ReadAllLines(versionFile)[0].Trim().TrimStart('v') != target)
                    throw new InvalidOperationException("Installed version verification failed.");
            }
            try { File.Copy(log, Path.Combine(install, "wandou-ai-update.log"), true); } catch { }
            Log(log, "Native update completed. Restarting application.");
            Process.Start(new ProcessStartInfo(Path.Combine(install, executable)) { WorkingDirectory = install, UseShellExecute = true });
            return 0;
        }
        catch (Exception ex)
        {
            Log(log, "Native update failed: " + ex.Message);
            if (oldInstallMoved)
            {
                try
                {
                    if (newInstallActivated && Directory.Exists(install)) Directory.Move(install, failed);
                    if (Directory.Exists(previous)) Directory.Move(previous, install);
                    Log(log, "Previous installation restored after update failure.");
                }
                catch (Exception rollbackError)
                {
                    Log(log, "Rollback failed: " + rollbackError.Message);
                }
            }
            try { Process.Start(new ProcessStartInfo(Path.Combine(install, executable)) { WorkingDirectory = install, UseShellExecute = true }); } catch { }
            return 1;
        }
        finally { try { Directory.Delete(stage, true); } catch { } }
    }
}
