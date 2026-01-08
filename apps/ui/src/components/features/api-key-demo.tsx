"use client";

import { formatDistanceToNow } from "date-fns";
import { Key, Copy, MoreVertical, Shield } from "lucide-react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { mockApiKeys } from "@/lib/mock-feature-data";

export function ApiKeyDemo() {
	return (
		<Card>
			<CardHeader>
				<CardTitle>API Key Management</CardTitle>
				<CardDescription>
					Securely manage and monitor your API keys
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{mockApiKeys.map((apiKey) => (
						<div
							key={apiKey.id}
							className="flex items-center justify-between p-4 rounded-lg border bg-card hover:shadow-md transition-shadow"
						>
							<div className="flex items-center gap-4">
								<div className="p-2 rounded-lg bg-primary/10">
									<Key className="h-5 w-5 text-primary" />
								</div>
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										<p className="font-semibold">{apiKey.name}</p>
										<Badge variant="outline" className="text-xs">
											{apiKey.status}
										</Badge>
									</div>
									<div className="flex items-center gap-3 text-sm text-muted-foreground">
										<code className="text-xs bg-muted px-2 py-1 rounded">
											{apiKey.keyPrefix}••••{apiKey.lastFour}
										</code>
										<span>•</span>
										<span>{apiKey.usageCount.toLocaleString()} requests</span>
										<span>•</span>
										<span>
											Last used{" "}
											{formatDistanceToNow(apiKey.lastUsed, {
												addSuffix: true,
											})}
										</span>
									</div>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<Button variant="ghost" size="icon">
									<Copy className="h-4 w-4" />
								</Button>
								<Button variant="ghost" size="icon">
									<MoreVertical className="h-4 w-4" />
								</Button>
							</div>
						</div>
					))}

					<div className="mt-6 p-4 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30">
						<div className="flex items-start gap-3">
							<Shield className="h-5 w-5 text-muted-foreground mt-0.5" />
							<div className="space-y-1">
								<p className="font-medium">Secure Key Storage</p>
								<p className="text-sm text-muted-foreground">
									All API keys are encrypted at rest and in transit. Keys are
									only shown once during creation and cannot be retrieved later.
								</p>
							</div>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
