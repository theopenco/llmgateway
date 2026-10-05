import { Navbar } from "./navbar";

export function Hero({
	sticky = true,
	pilotCta,
	children,
}: {
	sticky?: boolean;
	pilotCta?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Navbar sticky={sticky} pilotCta={pilotCta}>
			{children}
		</Navbar>
	);
}
