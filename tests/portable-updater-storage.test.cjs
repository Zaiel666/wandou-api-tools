// Protocol 2 supersedes directory-wide replacement and legacy PowerShell.
// Keep the established test entry point, with actual executable/transaction
// coverage rather than assertions that unknown .previous files get deleted.
require('./safe-updater-protocol-v223.test.cjs');
