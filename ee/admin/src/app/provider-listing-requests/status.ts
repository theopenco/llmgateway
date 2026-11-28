export function getStatusBadgeVariant(status: string) {
	switch (status) {
		case "delivered":
			return "default";
		case "rejected":
		case "delivery_failed":
			return "destructive";
		case "pending":
			return "secondary";
		default:
			return "outline";
	}
}

export function getStatusLabel(status: string) {
	switch (status) {
		case "delivery_failed":
			return "Failed";
		default:
			return status.charAt(0).toUpperCase() + status.slice(1);
	}
}

export function getPaymentBadgeVariant(status: string) {
	switch (status) {
		case "paid":
			return "default";
		case "refunded":
			return "secondary";
		default:
			return "outline";
	}
}
