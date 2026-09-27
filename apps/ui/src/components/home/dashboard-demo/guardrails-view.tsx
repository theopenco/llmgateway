"use client";

import { Building2, Plus, Save, Trash2, X } from "lucide-react";
import { useState } from "react";

import {
	ALLOWED_FILE_TYPES,
	CUSTOM_RULES,
	DEFAULT_SYSTEM_RULES,
	SYSTEM_RULES,
	type GuardrailAction,
	type SystemRuleId,
} from "@/components/home/dashboard-demo-data";
import { Alert, AlertDescription, AlertTitle } from "@/lib/components/alert";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Switch } from "@/lib/components/switch";

import { READ_ONLY_MESSAGE, useDemo } from "./context";

type CustomRuleType = "blocked_terms" | "custom_regex" | "topic_restriction";

export function GuardrailsView() {
	const { notify, track } = useDemo();
	const [enabled, setEnabled] = useState(true);
	const [systemRules, setSystemRules] = useState(DEFAULT_SYSTEM_RULES);
	const [maxFileSizeMb, setMaxFileSizeMb] = useState(10);
	const [allowedFileTypes, setAllowedFileTypes] = useState(ALLOWED_FILE_TYPES);
	const [rules, setRules] = useState(CUSTOM_RULES);
	const [showAddRule, setShowAddRule] = useState(false);
	const [newRule, setNewRule] = useState({
		name: "",
		type: "blocked_terms" as CustomRuleType,
		action: "block" as GuardrailAction,
		terms: "",
		pattern: "",
		topics: "",
	});

	const updateSystemRule = (
		ruleId: SystemRuleId,
		patch: Partial<{ enabled: boolean; action: GuardrailAction }>,
	) => {
		setSystemRules({
			...systemRules,
			[ruleId]: { ...systemRules[ruleId], ...patch },
		});
		track("guardrail_rule", `${ruleId}:${patch.enabled ?? patch.action}`);
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl font-bold tracking-tight md:text-3xl">
						Guardrails
					</h2>
				</div>
				<div className="space-y-6">
					<Card>
						<CardHeader>
							<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
								<div>
									<CardTitle>Guardrails</CardTitle>
									<CardDescription>
										Configure content safety rules for your LLM applications
									</CardDescription>
								</div>
								<div className="flex items-center gap-4">
									<div className="flex items-center gap-2">
										<Switch
											checked={enabled}
											onCheckedChange={(value) => {
												setEnabled(value);
												track("guardrails_enabled", String(value));
											}}
										/>
										<Label>{enabled ? "Enabled" : "Disabled"}</Label>
									</div>
									<Button onClick={() => notify(READ_ONLY_MESSAGE)}>
										<Save className="mr-2 h-4 w-4" />
										Save Changes
									</Button>
								</div>
							</div>
						</CardHeader>
					</Card>

					<Alert>
						<Building2 />
						<AlertTitle>1 project overrides these settings</AlertTitle>
						<AlertDescription>
							<span>
								The settings below apply to every project except{" "}
								<span className="underline underline-offset-4">Staging</span>,
								which enforces its own guardrails.
							</span>
						</AlertDescription>
					</Alert>

					<div
						className={
							enabled ? "" : "pointer-events-none select-none opacity-60"
						}
					>
						<Card className="mb-6">
							<CardHeader>
								<CardTitle>System Rules</CardTitle>
								<CardDescription>
									Built-in security rules powered by pattern matching
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								{SYSTEM_RULES.map((rule) => {
									const ruleConfig = systemRules[rule.id];
									return (
										<div
											key={rule.id}
											className="flex items-center justify-between gap-3 rounded-lg border p-4"
										>
											<div className="flex items-center gap-4">
												<Switch
													checked={ruleConfig.enabled}
													disabled={!enabled}
													onCheckedChange={(value) =>
														updateSystemRule(rule.id, { enabled: value })
													}
												/>
												<div>
													<div className="font-medium">{rule.name}</div>
													<div className="text-sm text-muted-foreground">
														{rule.description}
													</div>
												</div>
											</div>
											{ruleConfig.enabled && (
												<Select
													value={ruleConfig.action}
													disabled={!enabled}
													onValueChange={(value) =>
														updateSystemRule(rule.id, {
															action: value as GuardrailAction,
														})
													}
												>
													<SelectTrigger className="w-32 shrink-0">
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="block">Block</SelectItem>
														{(rule.id === "pii_detection" ||
															rule.id === "secrets") && (
															<SelectItem value="redact">Redact</SelectItem>
														)}
														<SelectItem value="warn">Warn</SelectItem>
														<SelectItem value="allow">Allow</SelectItem>
													</SelectContent>
												</Select>
											)}
										</div>
									);
								})}
							</CardContent>
						</Card>

						<Card className="mb-6">
							<CardHeader>
								<CardTitle>File Restrictions</CardTitle>
								<CardDescription>
									Configure allowed file types and size limits
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-4">
								<div className="space-y-2">
									<Label>Maximum File Size (MB)</Label>
									<Input
										type="number"
										value={maxFileSizeMb}
										disabled={!enabled}
										onChange={(e) =>
											setMaxFileSizeMb(parseInt(e.target.value, 10) || 10)
										}
										className="w-32"
									/>
								</div>
								<div className="space-y-2">
									<Label>Allowed File Types</Label>
									<div className="flex flex-wrap gap-2">
										{allowedFileTypes.map((type) => (
											<Badge key={type} variant="secondary">
												{type}
												{enabled && (
													<button
														type="button"
														onClick={() =>
															setAllowedFileTypes(
																allowedFileTypes.filter((t) => t !== type),
															)
														}
														className="ml-1 hover:text-destructive"
													>
														<X className="h-3 w-3" />
													</button>
												)}
											</Badge>
										))}
									</div>
									<div className="flex gap-2">
										<Input
											placeholder="Add file type (e.g., pdf)"
											className="w-48"
											disabled={!enabled}
											onKeyDown={(e) => {
												if (e.key === "Enter") {
													const input = e.currentTarget;
													const value = input.value.trim().toLowerCase();
													if (value && !allowedFileTypes.includes(value)) {
														setAllowedFileTypes([...allowedFileTypes, value]);
														input.value = "";
													}
												}
											}}
										/>
									</div>
								</div>
							</CardContent>
						</Card>

						<Card>
							<CardHeader>
								<div className="flex items-center justify-between gap-3">
									<div>
										<CardTitle>Custom Rules</CardTitle>
										<CardDescription>
											Create custom content filtering rules
										</CardDescription>
									</div>
									<Button
										onClick={() => setShowAddRule(true)}
										variant="outline"
										disabled={!enabled}
									>
										<Plus className="mr-2 h-4 w-4" />
										Add Rule
									</Button>
								</div>
							</CardHeader>
							<CardContent className="space-y-4">
								{showAddRule && enabled && (
									<div className="space-y-4 rounded-lg border bg-muted/50 p-4">
										<div className="flex items-center justify-between">
											<h4 className="font-medium">New Rule</h4>
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setShowAddRule(false)}
											>
												<X className="h-4 w-4" />
											</Button>
										</div>
										<div className="grid gap-4 md:grid-cols-2">
											<div className="space-y-2">
												<Label>Rule Name</Label>
												<Input
													value={newRule.name}
													onChange={(e) =>
														setNewRule({ ...newRule, name: e.target.value })
													}
													placeholder="e.g., Block competitors"
												/>
											</div>
											<div className="space-y-2">
												<Label>Rule Type</Label>
												<Select
													value={newRule.type}
													onValueChange={(value) => {
														const type = value as CustomRuleType;
														setNewRule({
															...newRule,
															type,
															action:
																type === "topic_restriction" &&
																newRule.action === "redact"
																	? "block"
																	: newRule.action,
														});
													}}
												>
													<SelectTrigger>
														<SelectValue />
													</SelectTrigger>
													<SelectContent>
														<SelectItem value="blocked_terms">
															Blocked Terms
														</SelectItem>
														<SelectItem value="custom_regex">
															Custom Regex
														</SelectItem>
														<SelectItem value="topic_restriction">
															Topic Restriction
														</SelectItem>
													</SelectContent>
												</Select>
											</div>
										</div>
										<div className="space-y-2">
											<Label>Action</Label>
											<Select
												value={newRule.action}
												onValueChange={(value) =>
													setNewRule({
														...newRule,
														action: value as GuardrailAction,
													})
												}
											>
												<SelectTrigger className="w-48">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="block">Block</SelectItem>
													{newRule.type !== "topic_restriction" && (
														<SelectItem value="redact">Redact</SelectItem>
													)}
													<SelectItem value="warn">Warn</SelectItem>
													<SelectItem value="allow">
														Allow (Log Only)
													</SelectItem>
												</SelectContent>
											</Select>
										</div>
										{newRule.type === "blocked_terms" && (
											<div className="space-y-2">
												<Label>Blocked Terms (one per line)</Label>
												<textarea
													value={newRule.terms}
													onChange={(e) =>
														setNewRule({ ...newRule, terms: e.target.value })
													}
													className="h-24 w-full resize-none rounded-md border px-3 py-2 text-sm"
													placeholder={
														"competitor\nsecret project\nconfidential"
													}
												/>
											</div>
										)}
										{newRule.type === "custom_regex" && (
											<div className="space-y-2">
												<Label>Regex Pattern</Label>
												<Input
													value={newRule.pattern}
													onChange={(e) =>
														setNewRule({ ...newRule, pattern: e.target.value })
													}
													placeholder="e.g., \\b\\d{3}-\\d{2}-\\d{4}\\b"
												/>
											</div>
										)}
										{newRule.type === "topic_restriction" && (
											<div className="space-y-2">
												<Label>Restricted Topics (one per line)</Label>
												<textarea
													value={newRule.topics}
													onChange={(e) =>
														setNewRule({ ...newRule, topics: e.target.value })
													}
													className="h-24 w-full resize-none rounded-md border px-3 py-2 text-sm"
													placeholder={"politics\nreligion\nviolence"}
												/>
											</div>
										)}
										<div className="flex justify-end gap-2">
											<Button
												variant="outline"
												onClick={() => setShowAddRule(false)}
											>
												Cancel
											</Button>
											<Button
												disabled={!newRule.name}
												onClick={() => {
													notify(READ_ONLY_MESSAGE);
													setShowAddRule(false);
												}}
											>
												Add Rule
											</Button>
										</div>
									</div>
								)}

								{rules.map((rule) => (
									<div
										key={rule.id}
										className="flex items-center justify-between gap-3 rounded-lg border p-4"
									>
										<div className="flex items-center gap-4">
											<Switch
												checked={rule.enabled}
												disabled={!enabled}
												onCheckedChange={() => {
													setRules(
														rules.map((item) =>
															item.id === rule.id
																? { ...item, enabled: !item.enabled }
																: item,
														),
													);
													track("custom_rule", rule.id);
												}}
											/>
											<div>
												<div className="flex flex-wrap items-center gap-2">
													<span className="font-medium">{rule.name}</span>
													<Badge variant="outline" className="text-xs">
														{rule.type.replace("_", " ")}
													</Badge>
												</div>
												<div className="text-sm text-muted-foreground">
													Action: {rule.action}
												</div>
											</div>
										</div>
										<div className="flex items-center gap-2">
											<Button
												variant="ghost"
												size="sm"
												disabled={!enabled}
												onClick={() => notify(READ_ONLY_MESSAGE)}
												className="text-destructive hover:text-destructive"
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
									</div>
								))}
							</CardContent>
						</Card>
					</div>
				</div>
			</div>
		</div>
	);
}
