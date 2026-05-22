"use client";

import {
	ExternalLinkIcon,
	PencilIcon,
	ScrollTextIcon,
	UploadIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CreateSkillDialog } from "@/components/playground/create-skill-dialog";
import { UploadSkillDialog } from "@/components/playground/upload-skill-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface SkillsMenuProps {
	hasActiveSkill?: boolean;
}

export function SkillsMenu({ hasActiveSkill = false }: SkillsMenuProps) {
	const router = useRouter();
	const [createOpen, setCreateOpen] = useState(false);
	const [uploadOpen, setUploadOpen] = useState(false);

	return (
		<>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="relative h-8 w-8"
								aria-label="Skills"
							>
								<ScrollTextIcon className="h-4 w-4" />
								{hasActiveSkill && (
									<span className="bg-primary absolute -top-1 -right-1 h-2 w-2 rounded-full" />
								)}
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent>
						<p>Skills</p>
					</TooltipContent>
				</Tooltip>

				<DropdownMenuContent align="end" className="w-48">
					<DropdownMenuItem onSelect={() => setCreateOpen(true)}>
						<PencilIcon className="mr-2 h-4 w-4" />
						Write skill instructions
					</DropdownMenuItem>
					<DropdownMenuItem onSelect={() => setUploadOpen(true)}>
						<UploadIcon className="mr-2 h-4 w-4" />
						Upload a skill
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={() => router.push("/skills")}>
						<ExternalLinkIcon className="mr-2 h-4 w-4" />
						View all skills
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<CreateSkillDialog open={createOpen} onOpenChange={setCreateOpen} />
			<UploadSkillDialog open={uploadOpen} onOpenChange={setUploadOpen} />
		</>
	);
}
