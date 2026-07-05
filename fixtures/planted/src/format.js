// Human-facing labels. A record with no title is a real, valid state — new
// drafts have none — so "Untitled" is the designed display default.
export function displayTitle(record) {
	return record.title ?? "Untitled"
}
