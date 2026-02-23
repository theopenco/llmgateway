ALTER TABLE "model_provider_mapping" ADD COLUMN "routing_uptime" real;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "routing_latency" real;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "routing_throughput" real;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "routing_total_requests" integer;