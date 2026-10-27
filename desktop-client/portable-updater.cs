using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Threading;
using System.Collections.Generic;

internal static class PortableUpdater
{
    const string RuntimeDirectoryName = "程序文件";
    const string ProjectDataDirectoryName = "豌豆AI数据";

    static bool HasMigrationDirectory(string root)
    {
        foreach (var entry in Directory.GetFileSystemEntries(root, ".wandou-project-migration-*", SearchOption.TopDirectoryOnly)) return true;
        return false;
    }

    static bool ContainsProtectedProjectData(string root)
    {
        if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0) return true;
        foreach (var name in new[] { ProjectDataDirectoryName, ".wandou-project-storage.json", ".wandou-migration-manifest.json",
            "canvas-media", "canvas-backups", "local-data", "export-artifacts", "project-hub-state.json" })
            if (File.Exists(Path.Combine(root, name)) || Directory.Exists(Path.Combine(root, name))) return true;
        return HasMigrationDirectory(root);
    }

    static void ValidateUpdatePackage(string package)
    {
        using (var archive = ZipFile.OpenRead(package))
        {
            foreach (var entry in archive.Entries)
            {
                var name = entry.FullName.Replace('\\', '/');
                var parts = name.Split('/');
                if (name.StartsWith("/") || name.IndexOf(':') >= 0) throw new InvalidOperationException("Unsafe update archive path.");
                foreach (var part in parts)
                {
                    if (part == ".." || part == "." || part.Equals(ProjectDataDirectoryName, StringComparison.OrdinalIgnoreCase)
                        || part.Equals(".wandou-project-storage.json", StringComparison.OrdinalIgnoreCase)
                        || part.StartsWith(".wandou-project-migration-", StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException("Update packages must not contain project data or migration directories.");
                }
            }
        }
    }

    // Enumerate only program files. Do not even descend into the potentially
    // large project-data directory or retained migration copies, so neither
    // updates nor rollback touch them. A failed migration may leave a recovery
    // stage after a later retry succeeds; that must not block future updates.
    static void CollectProgramEntries(string root, string directory, List<string> files, List<string> directories)
    {
        foreach (var entry in Directory.GetFileSystemEntries(directory))
        {
            if (directory.Equals(root, StringComparison.OrdinalIgnoreCase)
                && (Path.GetFileName(entry).Equals(ProjectDataDirectoryName, StringComparison.OrdinalIgnoreCase)
                    || Path.GetFileName(entry).StartsWith(".wandou-project-migration-", StringComparison.OrdinalIgnoreCase))) continue;
            var attributes = File.GetAttributes(entry);
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked program files cannot be updated safely.");
            if ((attributes & FileAttributes.Directory) != 0)
            {
                directories.Add(entry);
                CollectProgramEntries(root, entry, files, directories);
            }
            else files.Add(entry);
        }
    }

    static string Arg(string[] args, string name)
    {
        for (var i = 0; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
        return "";
    }

    static void Log(string path, string message)
    {
        try { File.AppendAllText(path, DateTime.UtcNow.ToString("u") + " " + message + Environment.NewLine); } catch { }
    }

    static void StopInstallProcesses(string install, string log)
    {
        var installRoot = Path.GetFullPath(install).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        for (var round = 0; round < 8; round++)
        {
            var found = false;
            foreach (var process in Process.GetProcesses())
            {
                try
                {
                    if (process.Id == Process.GetCurrentProcess().Id) continue;
                    var processPath = Path.GetFullPath(process.MainModule.FileName);
                    if (!processPath.StartsWith(installRoot, StringComparison.OrdinalIgnoreCase)) continue;
                    found = true;
                    Log(log, "Stopping install process " + process.Id + ": " + processPath);
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

    static void StopParentProcess(int parent, string log)
    {
        if (parent <= 0) return;
        try
        {
            using (var process = Process.GetProcessById(parent))
            {
                Log(log, "Stopping requesting parent process " + parent + ".");
                process.Kill();
                if (!process.WaitForExit(15000))
                {
                    Log(log, "Parent process shutdown timed out; continuing with install-scoped cleanup.");
                }
                else
                {
                    Log(log, "Requesting parent process stopped.");
                }
            }
        }
        catch (Exception ex)
        {
            Log(log, "Parent process-tree shutdown warning: " + ex.Message);
        }
    }

    static bool StartApplicationWithRetry(string install, string executable, string log)
    {
        var executablePath = Path.Combine(install, executable);
        for (var attempt = 1; attempt <= 5; attempt++)
        {
            try
            {
                var process = Process.Start(new ProcessStartInfo(executablePath)
                {
                    WorkingDirectory = install,
                    UseShellExecute = false
                });
                if (process == null) throw new InvalidOperationException("Process.Start returned no process.");
                Log(log, "Application restart launched process " + process.Id + " on attempt " + attempt + ".");
                Thread.Sleep(1500);
                if (!process.HasExited) return true;
                Log(log, "Restarted application exited early with code " + process.ExitCode + ".");
            }
            catch (Exception ex)
            {
                Log(log, "Application restart attempt " + attempt + " failed: " + ex.Message);
            }
            Thread.Sleep(1000);
        }
        return false;
    }

    static string VersionFile(string root)
    {
        var compatibility = Path.Combine(root, "resources", "app", "VERSION.txt");
        if (File.Exists(compatibility)) return compatibility;
        return Path.Combine(root, RuntimeDirectoryName, "resources", "app", "VERSION.txt");
    }

    static void VerifyPortableLayout(string root, string executable, string target, string description)
    {
        var versionFile = VersionFile(root);
        if (!File.Exists(Path.Combine(root, executable)) || !File.Exists(versionFile))
            throw new InvalidOperationException(description + " executable or version file is missing.");
        if (!String.IsNullOrWhiteSpace(target)
            && File.ReadAllLines(versionFile)[0].Trim().TrimStart('v') != target)
            throw new InvalidOperationException(description + " version verification failed.");

        var runtimeDirectory = Path.Combine(root, RuntimeDirectoryName);
        if (!Directory.Exists(runtimeDirectory)) return;
        var runtimeExecutable = Path.Combine(runtimeDirectory, executable);
        var runtimeVersion = Path.Combine(runtimeDirectory, "resources", "app", "VERSION.txt");
        if (!File.Exists(runtimeExecutable) || !File.Exists(runtimeVersion)
            || (!String.IsNullOrWhiteSpace(target)
                && File.ReadAllLines(runtimeVersion)[0].Trim().TrimStart('v') != target))
            throw new InvalidOperationException(description + " internal runtime verification failed.");
    }

    static void MoveDirectoryWithRetry(string source, string destination, string log)
    {
        Exception lastError = null;
        for (var attempt = 1; attempt <= 20; attempt++)
        {
            try
            {
                Directory.Move(source, destination);
                return;
            }
            catch (Exception ex)
            {
                lastError = ex;
                Log(log, "Directory move attempt " + attempt + " failed: " + ex.Message);
                Thread.Sleep(750);
            }
        }
        throw lastError ?? new IOException("Directory move failed.");
    }

    static bool DeleteDirectoryWithRetry(string directory, string log, string description = "previous installation")
    {
        if (String.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory)) return true;
        try
        {
            if (ContainsProtectedProjectData(directory))
            {
                Log(log, "Retaining " + description + " because it contains project data: " + directory);
                return false;
            }
        }
        catch (Exception ex) { Log(log, "Cannot verify cleanup safety; retaining " + directory + ": " + ex.Message); return false; }
        for (var attempt = 1; attempt <= 20; attempt++)
        {
            try
            {
                Directory.Delete(directory, true);
                if (!Directory.Exists(directory)) return true;
            }
            catch (Exception ex)
            {
                Log(log, description + " cleanup attempt " + attempt + " failed for " + directory + ": " + ex.Message);
            }
            Thread.Sleep(500);
        }
        Log(log, "Warning: " + description + " remains after cleanup retries: " + directory);
        return false;
    }

    static void CleanupPreviousInstallations(string install, string log)
    {
        try
        {
            var normalized = install.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var parent = Path.GetDirectoryName(normalized);
            var prefix = Path.GetFileName(normalized) + ".previous-";
            if (String.IsNullOrWhiteSpace(parent) || String.IsNullOrWhiteSpace(prefix)) return;
            foreach (var directory in Directory.GetDirectories(parent, prefix + "*", SearchOption.TopDirectoryOnly))
                DeleteDirectoryWithRetry(directory, log);
        }
        catch (Exception ex)
        {
            Log(log, "Previous installation cleanup warning: " + ex.Message);
        }
    }

    // A browser or Explorer can hold the install directory open even after all
    // application processes exit. Replace files without renaming that directory.
    // Journal each replacement so a failure restores all already changed files.
    static void ReplaceFilesWithRollback(string stage, string install, string previous, string log, string executable, string target)
    {
        var replaced = new List<string>();
        var backedUp = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var oldFiles = new List<string>();
        var oldDirectories = new List<string>();
        CollectProgramEntries(install, install, oldFiles, oldDirectories);
        var newFiles = new List<string>();
        var newDirectories = new List<string>();
        CollectProgramEntries(stage, stage, newFiles, newDirectories);
        Directory.CreateDirectory(previous);
        try
        {
            // A locked Explorer window may prevent renaming the outer directory. Move
            // every old file into the rollback area first so obsolete Electron DLLs
            // do not remain visible beside the new three-entry package.
            foreach (var destination in oldFiles)
            {
                var relative = destination.Substring(install.Length).TrimStart(Path.DirectorySeparatorChar);
                var backup = Path.Combine(previous, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(backup));
                File.Move(destination, backup);
                backedUp.Add(relative);
            }
            oldDirectories.Sort((left, right) => right.Length.CompareTo(left.Length));
            foreach (var directory in oldDirectories)
            {
                try { if (Directory.GetFileSystemEntries(directory).Length == 0) Directory.Delete(directory); } catch { }
            }
            foreach (var source in newFiles)
            {
                var relative = source.Substring(stage.Length).TrimStart(Path.DirectorySeparatorChar);
                var destination = Path.Combine(install, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(destination));
                replaced.Add(relative);
                File.Copy(source, destination, false);
            }
            // Verification belongs to the transaction: an incomplete new runtime
            // must restore the old program while leaving the data child in place.
            VerifyPortableLayout(install, executable, target, "Installed package");
        }
        catch
        {
            for (int i = replaced.Count - 1; i >= 0; i--)
            {
                var relative = replaced[i];
                var destination = Path.Combine(install, relative);
                if (File.Exists(destination)) File.Delete(destination);
            }
            foreach (var relative in backedUp)
            {
                var destination = Path.Combine(install, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(destination));
                if (!File.Exists(destination)) File.Move(Path.Combine(previous, relative), destination);
            }
            Log(log, "File replacements rolled back after failure.");
            throw;
        }
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
        var stage = Path.Combine(installParent, "wandou-ai-stage-" + Guid.NewGuid().ToString("N"));
        var previous = install.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + ".previous-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var failed = install.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + ".failed-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var oldInstallMoved = false;
        var newInstallActivated = false;
        var oldAppStopped = false;

        try
        {
            if (String.IsNullOrWhiteSpace(install) || !Directory.Exists(install) || !File.Exists(package)) throw new InvalidOperationException("Invalid update arguments.");
            install = Path.GetFullPath(install).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            if ((File.GetAttributes(install) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked installation directories are not supported.");
            ValidateUpdatePackage(package);
            // A child process inherits its parent's working directory on Windows.
            // If that directory is the portable installation, the updater itself
            // prevents Directory.Move from activating the new version.
            Environment.CurrentDirectory = Path.GetTempPath();
            File.WriteAllText(ready, "ready");
            Log(log, "Native updater accepted update request.");
            // Never use taskkill /T here: this updater is launched by the requesting
            // Electron process, so killing that tree also kills the updater itself.
            Thread.Sleep(250);
            StopParentProcess(parent, log);
            // Stop only remaining Electron processes whose executable lives inside this
            // installation. Unrelated portable copies with the same image name are safe.
            StopInstallProcesses(install, log);
            oldAppStopped = true;
            Thread.Sleep(1000);
            Log(log, "Extracting verified release package.");
            Directory.CreateDirectory(stage);
            ZipFile.ExtractToDirectory(package, stage);
            VerifyPortableLayout(stage, executable, target, "Package");
            // Prefer a directory swap. If a directory handle blocks renaming, move
            // each old file to backup before copying its replacement (never overwrite
            // memory-mapped resources in place).
            if (Directory.Exists(Path.Combine(install, ProjectDataDirectoryName)) || File.Exists(Path.Combine(install, ProjectDataDirectoryName)) || HasMigrationDirectory(install))
            {
                Log(log, "Preserving embedded project data; replacing program files only.");
                ReplaceFilesWithRollback(stage, install, previous, log, executable, target);
            }
            else
            {
                Log(log, "Activating new installation by directory swap.");
                try
                {
                    MoveDirectoryWithRetry(install, previous, log);
                    oldInstallMoved = true;
                }
                catch (IOException)
                {
                    Log(log, "Install directory is locked; using journaled file replacement.");
                    ReplaceFilesWithRollback(stage, install, previous, log, executable, target);
                }
                catch (UnauthorizedAccessException)
                {
                    Log(log, "Install directory is locked; using journaled file replacement.");
                    ReplaceFilesWithRollback(stage, install, previous, log, executable, target);
                }
            }
            if (oldInstallMoved)
            {
                MoveDirectoryWithRetry(stage, install, log);
                newInstallActivated = true;
            }
            VerifyPortableLayout(install, executable, target, "Installed package");
            try { File.Copy(log, Path.Combine(install, "wandou-ai-update.log"), true); } catch { }
            Log(log, "Native update completed. Restarting application.");
            if (StartApplicationWithRetry(install, executable, log))
            {
                CleanupPreviousInstallations(install, log);
                return 0;
            }
            Log(log, "Native update completed, but automatic restart failed after all retries.");
            return 2;
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
            if (oldAppStopped) StartApplicationWithRetry(install, executable, log);
            return 1;
        }
        finally
        {
            // In the locked-directory fallback the extracted stage is copied, not
            // moved. A transient scanner lock must not leave another full copy of
            // the application beside the installed folder after every update.
            if (Directory.Exists(stage))
            {
                try { File.WriteAllText(Path.Combine(stage, ".wandou-stage-cleanup-ready"), DateTime.UtcNow.ToString("u")); }
                catch (Exception markerError) { Log(log, "Unable to mark staging directory for later cleanup: " + markerError.Message); }
                DeleteDirectoryWithRetry(stage, log, "staging directory");
            }
        }
    }
}
