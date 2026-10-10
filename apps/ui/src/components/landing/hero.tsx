import { Navbar } from "./navbar";

export function Hero({
	sticky = true,
	children,
}: {
	sticky?: boolean;
	children: React.ReactNode;
}) {
	return <Navbar sticky={sticky}>{children}</Navbar>;
}
