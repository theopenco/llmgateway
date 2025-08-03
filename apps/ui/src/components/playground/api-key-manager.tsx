import { zodResolver } from "@hookform/resolvers/zod";
import { Key, AlertCircle, Eye, EyeOff, Trash2, Copy } from "lucide-react";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useApiKey } from "@/hooks/useApiKey";
import { useCreateApiKey } from "@/hooks/useCreateApiKey";
import { Alert, AlertDescription } from "@/lib/components/alert";
import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/lib/components/form";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";
import { toast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";

const apiKeySchema = z.object({
	apiKey: z
		.string()
		.min(1, { message: "API key is required" })
		.refine((key) => key.trim().length > 10, {
			message: "Please enter a valid API key",
		}),
});

interface ApiKeyManagerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	selectedModel: string;
}

function CreateNewKeyForm({
	onKeyCreated,
}: {
	onKeyCreated: (key: string) => void;
}) {
	const [name, setName] = useState("");
	const [newApiKey, setNewApiKey] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const { create } = useCreateApiKey();

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		setIsCreating(true);

		create(name, (token) => {
			setNewApiKey(token);
			onKeyCreated(token);
			setIsCreating(false);
		});
	};

	const copyToClipboard = () => {
		navigator.clipboard.writeText(newApiKey);
		toast({
			title: "API Key Copied",
			description: "The API key has been copied to your clipboard.",
		});
	};

	if (newApiKey) {
		return (
			<div className="space-y-4 py-4">
				<DialogHeader className="text-left">
					<DialogTitle>API Key Created</DialogTitle>
					<DialogDescription>
						Your API key has been created and applied. Please copy it now as you
						won't be able to see it again.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2">
					<Label htmlFor="api-key">API Key</Label>
					<div className="flex items-center space-x-2">
						<Input
							id="api-key"
							value={newApiKey}
							readOnly
							className="font-mono text-xs"
						/>
						<Button variant="outline" size="icon" onClick={copyToClipboard}>
							<Copy className="h-4 w-4" />
							<span className="sr-only">Copy API key</span>
						</Button>
					</div>
					<p className="text-muted-foreground text-xs">
						Make sure to store this API key securely.
					</p>
				</div>
			</div>
		);
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4 py-4">
			<div className="space-y-2">
				<Label htmlFor="name">API Key Name</Label>
				<Input
					id="name"
					placeholder="e.g. Playground Test Key"
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
				/>
			</div>
			<div className="flex justify-end gap-2 !mt-6">
				<Button type="submit" disabled={isCreating || !name}>
					{isCreating ? "Creating..." : "Create API Key"}
				</Button>
			</div>
		</form>
	);
}

export function ApiKeyManager({
	open,
	onOpenChange,
	selectedModel,
}: ApiKeyManagerProps) {
	const { userApiKey, setUserApiKey, clearUserApiKey, isLoaded } = useApiKey();
	const [isLoading, setIsLoading] = useState(false);
	const [isEditing, setIsEditing] = useState(false);
	const [showKey, setShowKey] = useState(false);
	const config = useAppConfig();

	const form = useForm<z.infer<typeof apiKeySchema>>({
		resolver: zodResolver(apiKeySchema),
		defaultValues: {
			apiKey: "",
		},
	});

	useEffect(() => {
		if (!open) {
			setIsEditing(false);
			setShowKey(false);
			form.reset();
		}
	}, [open, form]);

	const handleKeyCreatedAndSave = (key: string) => {
		setUserApiKey(key);
		toast({
			title: "API Key Saved",
			description: "Your new API key has been saved and activated!",
		});
		// The dialog will close automatically when the key is detected
	};

	const handleSubmit = async (values: z.infer<typeof apiKeySchema>) => {
		setIsLoading(true);
		try {
			const testResponse = await fetch(config.apiUrl + "/chat/completion", {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: selectedModel,
					messages: [{ role: "user", content: "Hello" }],
					stream: false,
					apiKey: values.apiKey.trim(),
				}),
			});

			if (!testResponse.ok) {
				const errorText = await testResponse.text();
				console.error("API key validation failed:", errorText);

				if (testResponse.status === 400) {
					throw new Error(
						"API key is required. Please check your key and try again.",
					);
				} else if (testResponse.status === 401) {
					throw new Error(
						"Invalid API key. Please check your key and try again.",
					);
				} else {
					throw new Error(
						`API key validation failed: ${testResponse.status} ${testResponse.statusText}`,
					);
				}
			}

			setUserApiKey(values.apiKey.trim());
			toast({
				title: "API Key Saved",
				description: "Your API key has been saved and activated successfully!",
			});
			onOpenChange(false);
			setIsEditing(false);
			form.reset();
		} catch (error: any) {
			toast({
				title: "Invalid API Key",
				description:
					error.message || "Please check your API key and try again.",
				variant: "destructive",
			});
		} finally {
			setIsLoading(false);
		}
	};

	const handleClearKey = () => {
		clearUserApiKey();
		toast({
			title: "API Key Cleared",
			description: "Your API key has been cleared.",
		});
		onOpenChange(false);
	};

	const renderContent = () => {
		if (!isLoaded) {
			return <p>Loading...</p>;
		}

		if (userApiKey && !isEditing) {
			return (
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="current-api-key">Your API Key</Label>
						<div className="flex items-center gap-2">
							<Input
								id="current-api-key"
								readOnly
								type={showKey ? "text" : "password"}
								value={userApiKey}
								className="font-mono"
							/>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setShowKey(!showKey)}
							>
								{showKey ? (
									<EyeOff className="h-4 w-4" />
								) : (
									<Eye className="h-4 w-4" />
								)}
							</Button>
						</div>
					</div>
					<div className="flex justify-between items-center">
						<div>
							<Button
								variant="destructive"
								onClick={handleClearKey}
								className="flex items-center gap-2"
							>
								<Trash2 className="h-4 w-4" />
								Clear Key
							</Button>
						</div>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
							>
								Close
							</Button>
							<Button onClick={() => setIsEditing(true)}>Edit Key</Button>
						</div>
					</div>
				</div>
			);
		}

		return (
			<Tabs defaultValue="paste" className="space-y-4">
				<TabsList className="grid w-full grid-cols-2">
					<TabsTrigger value="paste">Paste Existing Key</TabsTrigger>
					<TabsTrigger value="create">Create New Key</TabsTrigger>
				</TabsList>
				<TabsContent value="paste">
					<Alert>
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>
							Your API key is stored locally in your browser and is only used to
							make requests to the LLM Gateway API on your behalf.
						</AlertDescription>
					</Alert>
					<Form {...form}>
						<form
							onSubmit={form.handleSubmit(handleSubmit)}
							className="space-y-4 pt-4"
						>
							<FormField
								control={form.control}
								name="apiKey"
								render={({ field }) => (
									<FormItem>
										<FormLabel>API Key</FormLabel>
										<FormControl>
											<Input
												{...field}
												type="password"
												placeholder="Enter your LLM Gateway API key..."
												className="font-mono"
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<div className="flex justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									onClick={() => {
										if (userApiKey) {
											setIsEditing(false);
										} else {
											onOpenChange(false);
										}
									}}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={isLoading}>
									{isLoading ? "Validating..." : "Save API Key"}
								</Button>
							</div>
						</form>
					</Form>
				</TabsContent>
				<TabsContent value="create">
					<CreateNewKeyForm onKeyCreated={handleKeyCreatedAndSave} />
				</TabsContent>
			</Tabs>
		);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Key className="h-5 w-5" />
						{userApiKey && !isEditing
							? "Manage Your API Key"
							: "Enter Your API Key"}
					</DialogTitle>
					<DialogDescription>
						{userApiKey && !isEditing
							? "View, edit, or clear your saved API key."
							: "To use the playground, you need to provide your own LLM Gateway API key."}
					</DialogDescription>
				</DialogHeader>
				{renderContent()}
			</DialogContent>
		</Dialog>
	);
}
