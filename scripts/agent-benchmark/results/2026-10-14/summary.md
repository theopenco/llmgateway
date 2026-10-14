# Agent token benchmark: 2026-10-14

## By agent (all tasks and models)

| Agent       | Runs | Solved | Requests | Input tokens | Cached | Output tokens | Total tokens | Cost  |
| ----------- | ---- | ------ | -------- | ------------ | ------ | ------------- | ------------ | ----- |
| empryo      | 36   | 36     | 475      | 15.99M       | 14.69M | 0.21M         | 16.20M       | $8.55 |
| claude-code | 36   | 36     | 595      | 16.35M       | 15.15M | 0.26M         | 16.60M       | $6.45 |
| opencode    | 36   | 35     | 493      | 7.66M        | 6.85M  | 0.17M         | 7.82M        | $5.49 |

## By model (total tokens, summed over tasks)

| Model               | Empryo      | Claude Code | OpenCode    | Empryo cost | Claude Code cost | OpenCode cost |
| ------------------- | ----------- | ----------- | ----------- | ----------- | ---------------- | ------------- |
| Claude Fable 5.1    | 1.68M (6/6) | 1.86M (6/6) | 1.36M (6/6) | $5.30       | $3.70            | $3.47         |
| Claude Opus 5.5     | 1.37M (6/6) | 1.64M (6/6) | 1.03M (6/6) | $2.10       | $1.37            | $1.33         |
| GPT-6.1 Sol         | 1.83M (6/6) | 1.46M (6/6) | 0.98M (6/6) | $0.814      | $0.999           | $0.507        |
| GPT-6 Luna          | 4.75M (6/6) | 2.65M (6/6) | 1.38M (6/6) | $0.088      | $0.076           | $0.044        |
| DeepSeek V4.1 Flash | 3.78M (6/6) | 5.40M (6/6) | 1.33M (6/6) | $0.107      | $0.152           | $0.056        |
| GLM 5.3 Flash       | 2.79M (6/6) | 3.58M (6/6) | 1.74M (5/6) | $0.144      | $0.149           | $0.089        |

## Every run

| Task             | Model               | Agent       | Solved | Requests | Total tokens | Cached | Output | First request | Cost   | Wall  |
| ---------------- | ------------------- | ----------- | ------ | -------- | ------------ | ------ | ------ | ------------- | ------ | ----- |
| aws-lambda-query | deepseek-v4.1-flash | empryo      | yes    | 12       | 0.45M        | 0.40M  | 5.8K   | 26.3K         | $0.016 | 75s   |
| aws-lambda-query | deepseek-v4.1-flash | empryo      | yes    | 17       | 0.61M        | 0.58M  | 5.1K   | 26.3K         | $0.012 | 120s  |
| aws-lambda-query | deepseek-v4.1-flash | claude-code | yes    | 23       | 0.57M        | 0.53M  | 6.0K   | 17.3K         | $0.015 | 87s   |
| aws-lambda-query | deepseek-v4.1-flash | claude-code | yes    | 22       | 0.63M        | 0.58M  | 6.5K   | 17.3K         | $0.017 | 106s  |
| aws-lambda-query | deepseek-v4.1-flash | opencode    | yes    | 20       | 0.33M        | 0.30M  | 3.7K   | 7.6K          | $0.010 | 66s   |
| aws-lambda-query | deepseek-v4.1-flash | opencode    | yes    | 19       | 0.27M        | 0.24M  | 3.8K   | 7.6K          | $0.009 | 66s   |
| aws-lambda-query | fable-5.1           | empryo      | yes    | 8        | 0.27M        | 0.23M  | 2.6K   | 27.1K         | $0.879 | 71s   |
| aws-lambda-query | fable-5.1           | empryo      | yes    | 9        | 0.31M        | 0.27M  | 2.6K   | 27.1K         | $0.888 | 53s   |
| aws-lambda-query | fable-5.1           | claude-code | yes    | 9        | 0.29M        | 0.27M  | 3.5K   | 27.0K         | $0.496 | 67s   |
| aws-lambda-query | fable-5.1           | claude-code | yes    | 8        | 0.25M        | 0.23M  | 3.4K   | 27.0K         | $0.460 | 50s   |
| aws-lambda-query | fable-5.1           | opencode    | yes    | 15       | 0.28M        | 0.25M  | 3.6K   | 10.9K         | $0.563 | 74s   |
| aws-lambda-query | fable-5.1           | opencode    | yes    | 14       | 0.25M        | 0.23M  | 3.9K   | 10.9K         | $0.573 | 66s   |
| aws-lambda-query | glm-5.3-flash       | empryo      | yes    | 17       | 0.57M        | 0.52M  | 9.4K   | 24.6K         | $0.026 | 134s  |
| aws-lambda-query | glm-5.3-flash       | empryo      | yes    | 15       | 0.53M        | 0.48M  | 10.0K  | 24.6K         | $0.026 | 110s  |
| aws-lambda-query | glm-5.3-flash       | claude-code | yes    | 24       | 0.63M        | 0.60M  | 4.9K   | 16.8K         | $0.024 | 151s  |
| aws-lambda-query | glm-5.3-flash       | claude-code | yes    | 11       | 0.28M        | 0.25M  | 2.9K   | 16.8K         | $0.013 | 41s   |
| aws-lambda-query | glm-5.3-flash       | opencode    | yes    | 18       | 0.35M        | 0.32M  | 4.3K   | 7.3K          | $0.016 | 73s   |
| aws-lambda-query | glm-5.3-flash       | opencode    | yes    | 18       | 0.35M        | 0.32M  | 5.0K   | 7.3K          | $0.017 | 69s   |
| aws-lambda-query | gpt-6-luna          | empryo      | yes    | 49       | 1.99M        | 1.93M  | 6.3K   | 20.1K         | $0.029 | 236s  |
| aws-lambda-query | gpt-6-luna          | empryo      | yes    | 35       | 1.49M        | 1.42M  | 7.2K   | 20.1K         | $0.025 | 260s  |
| aws-lambda-query | gpt-6-luna          | claude-code | yes    | 22       | 0.67M        | 0.62M  | 7.8K   | 14.8K         | $0.015 | 123s  |
| aws-lambda-query | gpt-6-luna          | claude-code | yes    | 20       | 0.57M        | 0.53M  | 6.9K   | 14.8K         | $0.013 | 113s  |
| aws-lambda-query | gpt-6-luna          | opencode    | yes    | 15       | 0.28M        | 0.25M  | 3.0K   | 6.2K          | $0.007 | 64s   |
| aws-lambda-query | gpt-6-luna          | opencode    | yes    | 15       | 0.32M        | 0.28M  | 3.5K   | 6.2K          | $0.008 | 51s   |
| aws-lambda-query | gpt-6.1-sol         | empryo      | yes    | 14       | 0.46M        | 0.42M  | 2.0K   | 20.1K         | $0.162 | 196s  |
| aws-lambda-query | gpt-6.1-sol         | empryo      | yes    | 12       | 0.39M        | 0.34M  | 1.9K   | 20.1K         | $0.155 | 90s   |
| aws-lambda-query | gpt-6.1-sol         | claude-code | yes    | 11       | 0.26M        | 0.21M  | 2.9K   | 14.8K         | $0.159 | 75s   |
| aws-lambda-query | gpt-6.1-sol         | claude-code | yes    | 11       | 0.25M        | 0.20M  | 3.3K   | 14.8K         | $0.157 | 91s   |
| aws-lambda-query | gpt-6.1-sol         | opencode    | yes    | 11       | 0.13M        | 0.11M  | 2.0K   | 6.2K          | $0.077 | 85s   |
| aws-lambda-query | gpt-6.1-sol         | opencode    | yes    | 10       | 0.13M        | 0.11M  | 1.9K   | 6.2K          | $0.075 | 51s   |
| aws-lambda-query | opus-5.5            | empryo      | yes    | 7        | 0.24M        | 0.20M  | 2.3K   | 27.1K         | $0.369 | 72s   |
| aws-lambda-query | opus-5.5            | empryo      | yes    | 8        | 0.28M        | 0.24M  | 2.4K   | 27.1K         | $0.372 | 60s   |
| aws-lambda-query | opus-5.5            | claude-code | yes    | 10       | 0.32M        | 0.30M  | 2.9K   | 25.2K         | $0.214 | 66s   |
| aws-lambda-query | opus-5.5            | claude-code | yes    | 7        | 0.22M        | 0.20M  | 2.3K   | 25.2K         | $0.177 | 38s   |
| aws-lambda-query | opus-5.5            | opencode    | yes    | 12       | 0.25M        | 0.22M  | 4.1K   | 10.9K         | $0.265 | 112s  |
| aws-lambda-query | opus-5.5            | opencode    | yes    | 10       | 0.20M        | 0.17M  | 2.9K   | 10.9K         | $0.236 | 41s   |
| linear-router    | deepseek-v4.1-flash | empryo      | yes    | 22       | 0.73M        | 0.68M  | 7.9K   | 26.5K         | $0.019 | 712s  |
| linear-router    | deepseek-v4.1-flash | empryo      | yes    | 26       | 0.97M        | 0.93M  | 14.0K  | 26.5K         | $0.022 | 230s  |
| linear-router    | deepseek-v4.1-flash | claude-code | yes    | 25       | 0.64M        | 0.59M  | 12.2K  | 17.3K         | $0.020 | 1007s |
| linear-router    | deepseek-v4.1-flash | claude-code | yes    | 41       | 1.15M        | 1.06M  | 17.4K  | 17.3K         | $0.035 | 1238s |
| linear-router    | deepseek-v4.1-flash | opencode    | yes    | 10       | 0.11M        | 0.09M  | 2.7K   | 7.7K          | $0.006 | 39s   |
| linear-router    | deepseek-v4.1-flash | opencode    | yes    | 8        | 0.08M        | 0.06M  | 2.4K   | 7.7K          | $0.005 | 57s   |
| linear-router    | fable-5.1           | empryo      | yes    | 11       | 0.36M        | 0.32M  | 2.7K   | 27.4K         | $0.866 | 68s   |
| linear-router    | fable-5.1           | empryo      | yes    | 7        | 0.23M        | 0.19M  | 1.8K   | 27.4K         | $0.765 | 64s   |
| linear-router    | fable-5.1           | claude-code | yes    | 16       | 0.56M        | 0.51M  | 6.8K   | 27.0K         | $0.982 | 142s  |
| linear-router    | fable-5.1           | claude-code | yes    | 11       | 0.36M        | 0.34M  | 4.8K   | 27.0K         | $0.575 | 83s   |
| linear-router    | fable-5.1           | opencode    | yes    | 16       | 0.25M        | 0.23M  | 4.9K   | 10.9K         | $0.561 | 104s  |
| linear-router    | fable-5.1           | opencode    | yes    | 13       | 0.19M        | 0.17M  | 4.1K   | 10.9K         | $0.488 | 71s   |
| linear-router    | glm-5.3-flash       | empryo      | yes    | 16       | 0.55M        | 0.49M  | 18.1K  | 24.8K         | $0.030 | 189s  |
| linear-router    | glm-5.3-flash       | empryo      | yes    | 15       | 0.48M        | 0.43M  | 10.0K  | 24.8K         | $0.023 | 107s  |
| linear-router    | glm-5.3-flash       | claude-code | yes    | 10       | 0.22M        | 0.19M  | 4.4K   | 16.8K         | $0.011 | 50s   |
| linear-router    | glm-5.3-flash       | claude-code | yes    | 8        | 0.16M        | 0.13M  | 3.1K   | 16.8K         | $0.009 | 33s   |
| linear-router    | glm-5.3-flash       | opencode    | yes    | 16       | 0.40M        | 0.35M  | 7.1K   | 7.3K          | $0.020 | 133s  |
| linear-router    | glm-5.3-flash       | opencode    | yes    | 11       | 0.12M        | 0.10M  | 3.2K   | 7.3K          | $0.007 | 39s   |
| linear-router    | gpt-6-luna          | empryo      | yes    | 7        | 0.18M        | 0.15M  | 1.2K   | 20.3K         | $0.006 | 42s   |
| linear-router    | gpt-6-luna          | empryo      | yes    | 7        | 0.17M        | 0.14M  | 1.6K   | 20.3K         | $0.006 | 66s   |
| linear-router    | gpt-6-luna          | claude-code | yes    | 10       | 0.18M        | 0.15M  | 2.2K   | 14.8K         | $0.005 | 74s   |
| linear-router    | gpt-6-luna          | claude-code | yes    | 9        | 0.16M        | 0.14M  | 2.4K   | 14.8K         | $0.005 | 57s   |
| linear-router    | gpt-6-luna          | opencode    | yes    | 10       | 0.09M        | 0.08M  | 1.8K   | 6.3K          | $0.003 | 67s   |
| linear-router    | gpt-6-luna          | opencode    | yes    | 10       | 0.10M        | 0.09M  | 1.8K   | 6.3K          | $0.004 | 63s   |
| linear-router    | gpt-6.1-sol         | empryo      | yes    | 9        | 0.23M        | 0.20M  | 1.5K   | 20.3K         | $0.107 | 78s   |
| linear-router    | gpt-6.1-sol         | empryo      | yes    | 7        | 0.20M        | 0.16M  | 1.5K   | 20.3K         | $0.112 | 63s   |
| linear-router    | gpt-6.1-sol         | claude-code | yes    | 9        | 0.17M        | 0.13M  | 3.5K   | 14.8K         | $0.145 | 92s   |
| linear-router    | gpt-6.1-sol         | claude-code | yes    | 11       | 0.22M        | 0.18M  | 4.5K   | 14.8K         | $0.162 | 111s  |
| linear-router    | gpt-6.1-sol         | opencode    | yes    | 13       | 0.15M        | 0.13M  | 1.8K   | 6.3K          | $0.072 | 62s   |
| linear-router    | gpt-6.1-sol         | opencode    | yes    | 13       | 0.14M        | 0.12M  | 2.0K   | 6.3K          | $0.071 | 57s   |
| linear-router    | opus-5.5            | empryo      | yes    | 7        | 0.23M        | 0.19M  | 2.0K   | 27.4K         | $0.332 | 54s   |
| linear-router    | opus-5.5            | empryo      | yes    | 6        | 0.19M        | 0.15M  | 2.0K   | 27.4K         | $0.318 | 48s   |
| linear-router    | opus-5.5            | claude-code | yes    | 9        | 0.27M        | 0.24M  | 3.1K   | 25.2K         | $0.272 | 39s   |
| linear-router    | opus-5.5            | claude-code | yes    | 8        | 0.24M        | 0.22M  | 2.9K   | 25.2K         | $0.179 | 55s   |
| linear-router    | opus-5.5            | opencode    | yes    | 9        | 0.13M        | 0.11M  | 3.4K   | 10.9K         | $0.188 | 46s   |
| linear-router    | opus-5.5            | opencode    | yes    | 9        | 0.13M        | 0.11M  | 3.0K   | 10.9K         | $0.176 | 40s   |
| pretty-json      | deepseek-v4.1-flash | empryo      | yes    | 19       | 0.68M        | 0.61M  | 18.8K  | 26.4K         | $0.026 | 232s  |
| pretty-json      | deepseek-v4.1-flash | empryo      | yes    | 11       | 0.35M        | 0.32M  | 9.2K   | 26.4K         | $0.011 | 119s  |
| pretty-json      | deepseek-v4.1-flash | claude-code | yes    | 41       | 1.45M        | 1.37M  | 29.9K  | 17.3K         | $0.040 | 333s  |
| pretty-json      | deepseek-v4.1-flash | claude-code | yes    | 36       | 0.97M        | 0.92M  | 16.4K  | 17.3K         | $0.026 | 217s  |
| pretty-json      | deepseek-v4.1-flash | opencode    | yes    | 17       | 0.28M        | 0.25M  | 8.0K   | 7.7K          | $0.013 | 152s  |
| pretty-json      | deepseek-v4.1-flash | opencode    | yes    | 15       | 0.26M        | 0.23M  | 8.5K   | 7.7K          | $0.013 | 102s  |
| pretty-json      | fable-5.1           | empryo      | yes    | 8        | 0.27M        | 0.23M  | 5.7K   | 27.2K         | $1.01  | 84s   |
| pretty-json      | fable-5.1           | empryo      | yes    | 7        | 0.23M        | 0.19M  | 3.9K   | 27.2K         | $0.885 | 81s   |
| pretty-json      | fable-5.1           | claude-code | yes    | 6        | 0.19M        | 0.17M  | 4.0K   | 27.0K         | $0.462 | 59s   |
| pretty-json      | fable-5.1           | claude-code | yes    | 6        | 0.20M        | 0.16M  | 4.8K   | 27.0K         | $0.728 | 94s   |
| pretty-json      | fable-5.1           | opencode    | yes    | 12       | 0.17M        | 0.15M  | 5.9K   | 10.9K         | $0.564 | 87s   |
| pretty-json      | fable-5.1           | opencode    | yes    | 14       | 0.21M        | 0.18M  | 8.4K   | 10.9K         | $0.719 | 134s  |
| pretty-json      | glm-5.3-flash       | empryo      | yes    | 14       | 0.43M        | 0.38M  | 14.3K  | 24.7K         | $0.024 | 240s  |
| pretty-json      | glm-5.3-flash       | empryo      | yes    | 8        | 0.23M        | 0.19M  | 10.6K  | 24.7K         | $0.016 | 108s  |
| pretty-json      | glm-5.3-flash       | claude-code | yes    | 29       | 0.85M        | 0.80M  | 14.0K  | 16.8K         | $0.036 | 183s  |
| pretty-json      | glm-5.3-flash       | claude-code | yes    | 51       | 1.45M        | 1.40M  | 14.5K  | 16.8K         | $0.055 | 227s  |
| pretty-json      | glm-5.3-flash       | opencode    | no     | 17       | 0.23M        | 0.21M  | 7.3K   | 7.3K          | $0.013 | 89s   |
| pretty-json      | glm-5.3-flash       | opencode    | yes    | 15       | 0.28M        | 0.24M  | 11.3K  | 7.3K          | $0.017 | 92s   |
| pretty-json      | gpt-6-luna          | empryo      | yes    | 16       | 0.49M        | 0.45M  | 6.7K   | 20.2K         | $0.012 | 142s  |
| pretty-json      | gpt-6-luna          | empryo      | yes    | 17       | 0.43M        | 0.40M  | 5.4K   | 20.2K         | $0.010 | 133s  |
| pretty-json      | gpt-6-luna          | claude-code | yes    | 16       | 0.55M        | 0.48M  | 19.7K  | 14.8K         | $0.020 | 175s  |
| pretty-json      | gpt-6-luna          | claude-code | yes    | 18       | 0.52M        | 0.47M  | 14.7K  | 14.8K         | $0.017 | 136s  |
| pretty-json      | gpt-6-luna          | opencode    | yes    | 17       | 0.27M        | 0.23M  | 10.0K  | 6.3K          | $0.010 | 169s  |
| pretty-json      | gpt-6-luna          | opencode    | yes    | 18       | 0.32M        | 0.29M  | 10.4K  | 6.3K          | $0.011 | 158s  |
| pretty-json      | gpt-6.1-sol         | empryo      | yes    | 9        | 0.28M        | 0.24M  | 2.8K   | 20.2K         | $0.145 | 100s  |
| pretty-json      | gpt-6.1-sol         | empryo      | yes    | 9        | 0.27M        | 0.24M  | 2.1K   | 20.2K         | $0.132 | 83s   |
| pretty-json      | gpt-6.1-sol         | claude-code | yes    | 14       | 0.29M        | 0.24M  | 5.4K   | 14.8K         | $0.201 | 143s  |
| pretty-json      | gpt-6.1-sol         | claude-code | yes    | 13       | 0.27M        | 0.22M  | 5.0K   | 14.8K         | $0.176 | 116s  |
| pretty-json      | gpt-6.1-sol         | opencode    | yes    | 14       | 0.19M        | 0.16M  | 2.9K   | 6.3K          | $0.100 | 90s   |
| pretty-json      | gpt-6.1-sol         | opencode    | yes    | 17       | 0.24M        | 0.21M  | 3.4K   | 6.3K          | $0.112 | 94s   |
| pretty-json      | opus-5.5            | empryo      | yes    | 7        | 0.22M        | 0.18M  | 3.2K   | 27.2K         | $0.359 | 82s   |
| pretty-json      | opus-5.5            | empryo      | yes    | 7        | 0.22M        | 0.18M  | 3.1K   | 27.2K         | $0.349 | 59s   |
| pretty-json      | opus-5.5            | claude-code | yes    | 10       | 0.30M        | 0.28M  | 4.3K   | 25.2K         | $0.220 | 67s   |
| pretty-json      | opus-5.5            | claude-code | yes    | 10       | 0.30M        | 0.26M  | 4.3K   | 25.2K         | $0.305 | 62s   |
| pretty-json      | opus-5.5            | opencode    | yes    | 12       | 0.18M        | 0.16M  | 5.9K   | 10.9K         | $0.253 | 82s   |
| pretty-json      | opus-5.5            | opencode    | yes    | 10       | 0.14M        | 0.12M  | 4.3K   | 10.9K         | $0.208 | 81s   |
