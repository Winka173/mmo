# Historical verification reports after cleanup

On 25 October 2026 the owner requested removal of generated test data and redundant files. Generated benchmark/smoke media, isolated data stores, installed test copies, screenshots and logs were deleted. Small JSON/Markdown reports remain as historical records.

Paths to deleted artifacts do not indicate that those files are still present, and these reports do not represent a new test run. Some integration harnesses reuse previous real speech artifacts and need those fixtures regenerated before running again.

The current `dist/windows` installer, portable executable and all 9,858 resource files were retained and checked against their existing hashes. No user data/credentials or installed model checkpoints were deleted. See [CLEANUP_NOTES.md](../CLEANUP_NOTES.md) for the measured cleanup scope and remaining files.
