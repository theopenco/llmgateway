{{/*
Expand the name of the chart.
*/}}
{{- define "llmgateway.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "llmgateway.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "llmgateway.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "llmgateway.labels" -}}
helm.sh/chart: {{ include "llmgateway.chart" . }}
{{ include "llmgateway.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "llmgateway.selectorLabels" -}}
app.kubernetes.io/name: {{ include "llmgateway.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Component labels (call with dict "context" . "component" "api")
*/}}
{{- define "llmgateway.componentLabels" -}}
{{ include "llmgateway.labels" .context }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Component selector labels
*/}}
{{- define "llmgateway.componentSelectorLabels" -}}
{{ include "llmgateway.selectorLabels" .context }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Build image reference for a component.
Usage: {{ include "llmgateway.image" (dict "context" . "image" .Values.api.image) }}
*/}}
{{- define "llmgateway.image" -}}
{{- $registry := .image.registry | default .context.Values.global.image.registry -}}
{{- $repository := .image.repository -}}
{{- $tag := .image.tag | default .context.Values.global.image.tag | default .context.Chart.AppVersion -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repository $tag -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end }}

{{/*
Image pull secrets
*/}}
{{- define "llmgateway.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Secret name (supports existingSecret)
*/}}
{{- define "llmgateway.secretName" -}}
{{- if .Values.existingSecret }}
{{- .Values.existingSecret }}
{{- else }}
{{- include "llmgateway.fullname" . }}
{{- end }}
{{- end }}

{{/*
ConfigMap name
*/}}
{{- define "llmgateway.configMapName" -}}
{{- include "llmgateway.fullname" . }}-config
{{- end }}

{{/*
PostgreSQL host
*/}}
{{- define "llmgateway.postgresql.host" -}}
{{- if .Values.postgresql.enabled }}
{{- printf "%s-postgresql" (include "llmgateway.fullname" .) }}
{{- else }}
{{- .Values.externalPostgresql.host }}
{{- end }}
{{- end }}

{{/*
PostgreSQL port
*/}}
{{- define "llmgateway.postgresql.port" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.port | default 5432 }}
{{- else }}
{{- .Values.externalPostgresql.port | default 5432 }}
{{- end }}
{{- end }}

{{/*
PostgreSQL database
*/}}
{{- define "llmgateway.postgresql.database" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.database | default "llmgateway" }}
{{- else }}
{{- .Values.externalPostgresql.database | default "llmgateway" }}
{{- end }}
{{- end }}

{{/*
PostgreSQL user
*/}}
{{- define "llmgateway.postgresql.user" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.user | default "postgres" }}
{{- else }}
{{- .Values.externalPostgresql.user | default "postgres" }}
{{- end }}
{{- end }}

{{/*
Redis host
*/}}
{{- define "llmgateway.redis.host" -}}
{{- if .Values.redis.enabled }}
{{- printf "%s-redis" (include "llmgateway.fullname" .) }}
{{- else }}
{{- .Values.externalRedis.host }}
{{- end }}
{{- end }}

{{/*
Redis port
*/}}
{{- define "llmgateway.redis.port" -}}
{{- if .Values.redis.enabled }}
{{- .Values.redis.port | default 6379 }}
{{- else }}
{{- .Values.externalRedis.port | default 6379 }}
{{- end }}
{{- end }}

{{/*
Internal service URL helper.
Usage: {{ include "llmgateway.serviceUrl" (dict "context" . "name" "api") }}
*/}}
{{- define "llmgateway.serviceUrl" -}}
{{- printf "http://%s-%s:80" (include "llmgateway.fullname" .context) .name -}}
{{- end }}
