export type ReadByteRange = (start: number, length: number) => Promise<Buffer>;

// Enough for a 64-bit box header plus a version 1 mvhd up to its duration.
const BOX_READ_BYTES = 48;
const MAX_BOXES_PER_LEVEL = 64;

interface BoxHeader {
	type: string;
	size: number;
	headerSize: number;
}

function parseBoxHeader(bytes: Buffer): BoxHeader | null {
	if (bytes.length < 8) {
		return null;
	}
	const size = bytes.readUInt32BE(0);
	const type = bytes.toString("latin1", 4, 8);
	if (size === 1) {
		if (bytes.length < 16) {
			return null;
		}
		return { type, size: Number(bytes.readBigUInt64BE(8)), headerSize: 16 };
	}
	return { type, size, headerSize: 8 };
}

export function parseMvhdDurationSeconds(body: Buffer): number | null {
	const version = body.readUInt8(0);
	const timescaleOffset = version === 1 ? 20 : 12;
	if (body.length < timescaleOffset + (version === 1 ? 12 : 8)) {
		return null;
	}
	const timescale = body.readUInt32BE(timescaleOffset);
	const duration =
		version === 1
			? Number(body.readBigUInt64BE(timescaleOffset + 4))
			: body.readUInt32BE(timescaleOffset + 4);
	if (timescale === 0 || duration === 0) {
		return null;
	}
	return duration / timescale;
}

/**
 * Reads an MP4's duration from its movie header (moov/mvhd) with a handful of
 * small range reads, so the moov box may sit before or after mdat.
 */
export async function readMp4DurationSeconds(
	readRange: ReadByteRange,
): Promise<number> {
	let offset = 0;
	for (let index = 0; index < MAX_BOXES_PER_LEVEL; index++) {
		const header = parseBoxHeader(await readRange(offset, BOX_READ_BYTES));
		if (!header || header.size < header.headerSize) {
			break;
		}
		if (header.type === "moov") {
			let childOffset = offset + header.headerSize;
			const moovEnd = offset + header.size;
			for (
				let childIndex = 0;
				childIndex < MAX_BOXES_PER_LEVEL && childOffset < moovEnd;
				childIndex++
			) {
				const bytes = await readRange(childOffset, BOX_READ_BYTES);
				const child = parseBoxHeader(bytes);
				if (!child || child.size < child.headerSize) {
					break;
				}
				if (child.type === "mvhd") {
					const seconds = parseMvhdDurationSeconds(
						bytes.subarray(child.headerSize),
					);
					if (seconds === null) {
						break;
					}
					return seconds;
				}
				childOffset += child.size;
			}
			break;
		}
		offset += header.size;
	}
	throw new Error("MP4 movie header (moov/mvhd) not found");
}
