// Show cents normally, but reveal sub-cent precision when rounding to 2 decimals
// would hide real usage. A single chat can cost a fraction of a cent, which
// otherwise makes plan balances look frozen at the rounded value.
export function formatCredits(value: number): string {
	const twoDecimals = value.toFixed(2);
	if (Number(twoDecimals) === value) {
		return twoDecimals;
	}
	return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
