import type { Spec } from "@json-render/core";

export interface CanvasTemplate {
	name: string;
	description: string;
	spec: Spec;
}

export const templates: CanvasTemplate[] = [
	{
		name: "Dashboard",
		description: "Analytics dashboard with charts and KPIs",
		spec: {
			root: "root",
			elements: {
				root: {
					type: "Stack",
					props: { direction: "column", gap: 6 },
					children: ["heading", "kpis", "charts"],
				},
				heading: {
					type: "Heading",
					props: { level: "h2", text: "Analytics Dashboard" },
				},
				kpis: {
					type: "Grid",
					props: { columns: 4, gap: 4 },
					children: ["kpi1", "kpi2", "kpi3", "kpi4"],
				},
				kpi1: {
					type: "Card",
					props: { title: "Total Users", description: "12,543" },
					children: ["kpi1progress"],
				},
				kpi1progress: {
					type: "Progress",
					props: { value: 75, max: 100, label: "+12% from last month" },
				},
				kpi2: {
					type: "Card",
					props: { title: "Revenue", description: "$48,290" },
					children: ["kpi2progress"],
				},
				kpi2progress: {
					type: "Progress",
					props: { value: 60, max: 100, label: "+8% from last month" },
				},
				kpi3: {
					type: "Card",
					props: { title: "Active Sessions", description: "1,429" },
					children: ["kpi3progress"],
				},
				kpi3progress: {
					type: "Progress",
					props: { value: 45, max: 100, label: "+3% from last hour" },
				},
				kpi4: {
					type: "Card",
					props: { title: "Conversion Rate", description: "3.24%" },
					children: ["kpi4progress"],
				},
				kpi4progress: {
					type: "Progress",
					props: { value: 32, max: 100, label: "+0.5% from last week" },
				},
				charts: {
					type: "Grid",
					props: { columns: 2, gap: 4 },
					children: ["barChart", "lineChart"],
				},
				barChart: {
					type: "BarChart",
					props: {
						title: "Revenue by Month",
						description: "Last 6 months",
						data: [
							{ month: "Jan", revenue: 4200, expenses: 2400 },
							{ month: "Feb", revenue: 3800, expenses: 2100 },
							{ month: "Mar", revenue: 5100, expenses: 2800 },
							{ month: "Apr", revenue: 4600, expenses: 2500 },
							{ month: "May", revenue: 5800, expenses: 3200 },
							{ month: "Jun", revenue: 6200, expenses: 3500 },
						],
						series: [
							{ dataKey: "revenue", label: "Revenue" },
							{ dataKey: "expenses", label: "Expenses" },
						],
						xAxisKey: "month",
					},
				},
				lineChart: {
					type: "LineChart",
					props: {
						title: "User Growth",
						description: "Daily active users",
						data: [
							{ day: "Mon", users: 1200 },
							{ day: "Tue", users: 1350 },
							{ day: "Wed", users: 1100 },
							{ day: "Thu", users: 1450 },
							{ day: "Fri", users: 1600 },
							{ day: "Sat", users: 900 },
							{ day: "Sun", users: 800 },
						],
						series: [{ dataKey: "users", label: "Active Users" }],
						xAxisKey: "day",
						curved: true,
					},
				},
			},
		},
	},
	{
		name: "Form",
		description: "Contact form with validation",
		spec: {
			root: "root",
			elements: {
				root: {
					type: "Card",
					props: {
						title: "Contact Us",
						description: "Fill out the form below and we'll get back to you.",
						maxWidth: "lg",
						centered: true,
					},
					children: ["form"],
				},
				form: {
					type: "Stack",
					props: { direction: "column", gap: 4 },
					children: ["nameRow", "email", "subject", "message", "actions"],
				},
				nameRow: {
					type: "Grid",
					props: { columns: 2, gap: 4 },
					children: ["firstName", "lastName"],
				},
				firstName: {
					type: "Input",
					props: {
						label: "First Name",
						name: "firstName",
						placeholder: "John",
					},
				},
				lastName: {
					type: "Input",
					props: {
						label: "Last Name",
						name: "lastName",
						placeholder: "Doe",
					},
				},
				email: {
					type: "Input",
					props: {
						label: "Email",
						name: "email",
						type: "email",
						placeholder: "john@example.com",
					},
				},
				subject: {
					type: "Select",
					props: {
						label: "Subject",
						name: "subject",
						options: [
							{ label: "General Inquiry", value: "general" },
							{ label: "Technical Support", value: "support" },
							{ label: "Billing", value: "billing" },
							{ label: "Partnership", value: "partnership" },
						],
					},
				},
				message: {
					type: "Textarea",
					props: {
						label: "Message",
						name: "message",
						placeholder: "Tell us what's on your mind...",
						rows: 5,
					},
				},
				actions: {
					type: "Stack",
					props: { direction: "row", gap: 2, justify: "end" },
					children: ["resetBtn", "submitBtn"],
				},
				resetBtn: {
					type: "Button",
					props: { label: "Reset", variant: "outline" },
				},
				submitBtn: {
					type: "Button",
					props: { label: "Send Message", variant: "default" },
				},
			},
		},
	},
	{
		name: "Pricing",
		description: "Pricing cards with feature comparison",
		spec: {
			root: "root",
			elements: {
				root: {
					type: "Stack",
					props: { direction: "column", gap: 6 },
					children: ["header", "cards"],
				},
				header: {
					type: "Stack",
					props: { direction: "column", gap: 2, align: "center" },
					children: ["title", "subtitle"],
				},
				title: {
					type: "Heading",
					props: { level: "h2", text: "Simple, Transparent Pricing" },
				},
				subtitle: {
					type: "Text",
					props: {
						text: "Choose the plan that fits your needs. All plans include a 14-day free trial.",
						variant: "muted",
					},
				},
				cards: {
					type: "Grid",
					props: { columns: 3, gap: 4 },
					children: ["free", "pro", "enterprise"],
				},
				free: {
					type: "Card",
					props: { title: "Free", description: "$0 / month" },
					children: ["freeFeatures", "freeBtn"],
				},
				freeFeatures: {
					type: "Stack",
					props: { direction: "column", gap: 2 },
					children: ["f1", "f2", "f3"],
				},
				f1: { type: "Text", props: { text: "1,000 API calls / month" } },
				f2: { type: "Text", props: { text: "3 projects" } },
				f3: { type: "Text", props: { text: "Community support" } },
				freeBtn: {
					type: "Button",
					props: { label: "Get Started", variant: "outline" },
				},
				pro: {
					type: "Card",
					props: { title: "Pro", description: "$29 / month" },
					children: ["proFeatures", "proBtn"],
				},
				proFeatures: {
					type: "Stack",
					props: { direction: "column", gap: 2 },
					children: ["p1", "p2", "p3", "p4"],
				},
				p1: {
					type: "Text",
					props: { text: "100,000 API calls / month" },
				},
				p2: { type: "Text", props: { text: "Unlimited projects" } },
				p3: { type: "Text", props: { text: "Priority support" } },
				p4: { type: "Text", props: { text: "Custom models" } },
				proBtn: {
					type: "Button",
					props: { label: "Start Free Trial", variant: "default" },
				},
				enterprise: {
					type: "Card",
					props: { title: "Enterprise", description: "Custom pricing" },
					children: ["entFeatures", "entBtn"],
				},
				entFeatures: {
					type: "Stack",
					props: { direction: "column", gap: 2 },
					children: ["e1", "e2", "e3", "e4"],
				},
				e1: { type: "Text", props: { text: "Unlimited API calls" } },
				e2: { type: "Text", props: { text: "Dedicated infrastructure" } },
				e3: { type: "Text", props: { text: "SLA guarantee" } },
				e4: { type: "Text", props: { text: "24/7 phone support" } },
				entBtn: {
					type: "Button",
					props: { label: "Contact Sales", variant: "outline" },
				},
			},
		},
	},
	{
		name: "Charts",
		description: "Various chart types showcase",
		spec: {
			root: "root",
			elements: {
				root: {
					type: "Stack",
					props: { direction: "column", gap: 6 },
					children: ["heading", "row1", "row2"],
				},
				heading: {
					type: "Heading",
					props: { level: "h2", text: "Chart Gallery" },
				},
				row1: {
					type: "Grid",
					props: { columns: 2, gap: 4 },
					children: ["areaChart", "pieChart"],
				},
				areaChart: {
					type: "AreaChart",
					props: {
						title: "Traffic Overview",
						description: "Visitors and page views",
						data: [
							{ month: "Jan", visitors: 2400, pageViews: 4800 },
							{ month: "Feb", visitors: 1398, pageViews: 3200 },
							{ month: "Mar", visitors: 9800, pageViews: 15000 },
							{ month: "Apr", visitors: 3908, pageViews: 7800 },
							{ month: "May", visitors: 4800, pageViews: 9200 },
							{ month: "Jun", visitors: 3800, pageViews: 7600 },
						],
						series: [
							{ dataKey: "visitors", label: "Visitors" },
							{ dataKey: "pageViews", label: "Page Views" },
						],
						xAxisKey: "month",
						stacked: true,
					},
				},
				pieChart: {
					type: "PieChart",
					props: {
						title: "Browser Share",
						description: "Distribution by browser",
						data: [
							{ label: "Chrome", value: 65 },
							{ label: "Safari", value: 18 },
							{ label: "Firefox", value: 10 },
							{ label: "Edge", value: 5 },
							{ label: "Other", value: 2 },
						],
						innerRadius: 60,
						showLabel: false,
					},
				},
				row2: {
					type: "Grid",
					props: { columns: 2, gap: 4 },
					children: ["radarChart", "radialChart"],
				},
				radarChart: {
					type: "RadarChart",
					props: {
						title: "Skills Assessment",
						description: "Team competency overview",
						data: [
							{ skill: "Frontend", current: 80, target: 90 },
							{ skill: "Backend", current: 75, target: 85 },
							{ skill: "DevOps", current: 60, target: 80 },
							{ skill: "Design", current: 70, target: 75 },
							{ skill: "Testing", current: 65, target: 90 },
							{ skill: "Security", current: 55, target: 85 },
						],
						series: [
							{ dataKey: "current", label: "Current" },
							{ dataKey: "target", label: "Target" },
						],
						axisKey: "skill",
					},
				},
				radialChart: {
					type: "RadialBarChart",
					props: {
						title: "Goal Progress",
						description: "Quarterly targets",
						data: [
							{ label: "Revenue", value: 85 },
							{ label: "Users", value: 72 },
							{ label: "Features", value: 90 },
							{ label: "Support", value: 60 },
						],
						innerRadius: 30,
						showLabel: true,
					},
				},
			},
		},
	},
];

export const emptySpec: Spec = {
	root: "root",
	elements: {
		root: {
			type: "Stack",
			props: { direction: "column", gap: 4 },
			children: ["heading", "text"],
		},
		heading: {
			type: "Heading",
			props: { level: "h2", text: "Hello Canvas" },
		},
		text: {
			type: "Text",
			props: {
				text: "Edit the JSON on the left to build your UI. Use the templates above for inspiration.",
			},
		},
	},
};
