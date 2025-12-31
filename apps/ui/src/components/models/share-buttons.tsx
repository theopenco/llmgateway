"use client";

import { Check, Copy, Linkedin, Share2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import { XIcon } from "@/lib/icons/XIcon";

interface ShareButtonsProps {
	url: string;
	title: string;
}

export function ShareButtons({ url, title }: ShareButtonsProps) {
	const [copied, setCopied] = useState(false);

	const encodedUrl = encodeURIComponent(url);
	const encodedTitle = encodeURIComponent(title);

	const handleCopy = async () => {
		await navigator.clipboard.writeText(url);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	const xUrl = `https://x.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`;
	const linkedinUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="sm" className="gap-2">
					<Share2 className="h-4 w-4" />
					Share
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={handleCopy} className="cursor-pointer">
					{copied ? (
						<Check className="h-4 w-4 mr-2 text-green-500" />
					) : (
						<Copy className="h-4 w-4 mr-2" />
					)}
					{copied ? "Copied!" : "Copy URL"}
				</DropdownMenuItem>
				<DropdownMenuItem asChild className="cursor-pointer">
					<a href={xUrl} target="_blank" rel="noopener noreferrer">
						<XIcon className="h-4 w-4 mr-2" />
						Share on X
					</a>
				</DropdownMenuItem>
				<DropdownMenuItem asChild className="cursor-pointer">
					<a href={linkedinUrl} target="_blank" rel="noopener noreferrer">
						<Linkedin className="h-4 w-4 mr-2" />
						Share on LinkedIn
					</a>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
