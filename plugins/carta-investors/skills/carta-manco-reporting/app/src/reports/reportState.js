// Your report, shared from here; `dirty` means recipients don't have your latest changes.
export const ownShare = (report) => (report?.shared?.is_owner ? report.shared : null);
