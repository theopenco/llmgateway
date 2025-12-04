import "next-themes";

declare module "next-themes" {
	export interface ThemeProviderProps {
		children?: React.ReactNode;
	}
}
