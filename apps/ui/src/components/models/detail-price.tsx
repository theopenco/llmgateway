export function formatDetailPrice(
	price: string | null | undefined,
	discount?: string | null,
	align: "center" | "end" = "center",
	multiplier = 1,
) {
	if (price === null || price === undefined) {
		return "—";
	}
	const priceNum = parseFloat(price) * multiplier;
	const discountNum = discount ? parseFloat(discount) : 0;
	const originalPrice = parseFloat((priceNum * 1e6).toFixed(4));
	if (discountNum > 0) {
		const discountedPrice = parseFloat(
			(priceNum * 1e6 * (1 - discountNum)).toFixed(4),
		);
		return (
			<div
				className={`flex items-center gap-1 ${align === "end" ? "justify-end" : "justify-center"}`}
			>
				<span className="line-through text-muted-foreground text-xs">
					${originalPrice}
				</span>
				<span className="text-green-600 font-semibold">${discountedPrice}</span>
			</div>
		);
	}
	return `$${originalPrice}`;
}
