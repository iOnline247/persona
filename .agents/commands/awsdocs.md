---
agents: [Plan]
name: awsdocs
description: This prompt is used to find official AWS documentation to help answer user questions about AWS services, features, best practices, pricing, and troubleshooting.
argument-hint: Please provide a specific AWS-related topic or question you would like to research.
tools: ['agent', 'aws-documentation/read_documentation', 'aws-documentation/recommend', 'aws-documentation/search_documentation', 'aws-cdk/CDKGeneralGuidance', 'aws-cdk/ExplainCDKNagRule', 'aws-cdk/GetAwsSolutionsConstructPattern', 'aws-cdk/SearchGenAICDKConstructs']
---

Research this topic ${input} using official AWS documentation only. Provide references with links to the documentation used.

Display the ${input} at the top of your response for clarity.
Ensure all code snippets are formatted correctly for easy copying.

