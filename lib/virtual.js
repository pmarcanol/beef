import { reviewDiffRows } from './review.js';

export const VIRTUAL_OVERSCAN_PX = 900;
export const MAX_INLINE_DIFF_ROWS = 300;
export const VIRTUAL_DIFF_VIEWPORT_PX = 560;

export function estimateReviewCardHeight(entry) {
	if (entry?.file?.binary) return 148;
	const rows = reviewDiffRows(entry?.file?.patch || '');
	const noteRows = rows.filter(({ kind }) => kind === 'hunk' || kind === 'meta').length;
	const rowHeight = Math.max(1, rows.length) * 18 + noteRows * 8;
	return (
		86 +
		(rows.length > MAX_INLINE_DIFF_ROWS
			? Math.min(rowHeight, VIRTUAL_DIFF_VIEWPORT_PX)
			: rowHeight) +
		16
	);
}

export function buildVirtualOffsets(heights) {
	const offsets = [0];
	for (const height of heights) offsets.push(offsets.at(-1) + Math.max(1, height));
	return offsets;
}

export function virtualIndexAtOffset(offsets, value) {
	const itemCount = Math.max(0, offsets.length - 1);
	if (!itemCount) return 0;
	const target = Math.max(0, Math.min(value, offsets.at(-1) - 1));
	let low = 0;
	let high = itemCount - 1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		if (offsets[middle + 1] <= target) low = middle + 1;
		else if (offsets[middle] > target) high = middle - 1;
		else return middle;
	}
	return Math.max(0, Math.min(low, itemCount - 1));
}

export function virtualRange(offsets, viewportTop, viewportHeight, overscan = VIRTUAL_OVERSCAN_PX) {
	const itemCount = Math.max(0, offsets.length - 1);
	if (!itemCount) return { start: 0, end: 0 };
	const start = virtualIndexAtOffset(offsets, Math.max(0, viewportTop - overscan));
	const end = Math.min(
		itemCount,
		virtualIndexAtOffset(offsets, viewportTop + viewportHeight + overscan) + 1
	);
	return { start, end };
}
