import type { PlaybookManifest } from '../core/playbook-schema.js'

export const researchProspectPlaybook: PlaybookManifest = {
  id: 'research-prospect',
  version: '1.0.0',
  name: 'Research Prospect',
  description:
    'Research a company and optionally a specific person, generating structured insights and talking points',
  author: 'aar-platform',
  industry: ['sales', 'recruiting', 'consulting'],
  inputSchema: {
    type: 'object',
    required: ['company_name'],
    properties: {
      company_name: { type: 'string', description: 'Company to research' },
      person_name: {
        type: 'string',
        description: 'Specific person to research (optional)',
      },
      person_role: {
        type: 'string',
        description: 'Person role/title (optional)',
      },
      research_focus: {
        type: 'string',
        enum: ['general', 'funding', 'competitors', 'tech-stack'],
        default: 'general',
      },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      company_summary: { type: 'string' },
      key_facts: { type: 'string' },
      talking_points: { type: 'string' },
      personalized_summary: { type: 'string' },
      conversation_starters: { type: 'string' },
    },
  },
  steps: [
    {
      id: 'research-company',
      provider: 'openai',
      method: 'POST',
      path: 'v1/chat/completions',
      bodyTemplate: {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a business research analyst. Provide structured company research. Return a JSON object with keys: company_summary (string), key_facts (string with bullet points), recent_news (string), talking_points (string with bullet points).',
          },
          {
            role: 'user',
            content:
              'Research {{input.company_name}} with focus on: {{input.research_focus}}. Return JSON.',
          },
        ],
      },
      outputExtractor: {
        company_research: 'choices.0.message.content',
      },
      onError: 'fail',
    },
    {
      id: 'personalize-insights',
      provider: 'openai',
      method: 'POST',
      path: 'v1/chat/completions',
      bodyTemplate: {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a sales strategist. Given company research and a person, generate personalized insights. Return JSON with keys: personalized_summary (string), conversation_starters (string with bullet points), potential_pain_points (string with bullet points).',
          },
          {
            role: 'user',
            content:
              'Company research: {{steps.research-company.company_research}}\n\nPerson: {{input.person_name}} ({{input.person_role}}) at {{input.company_name}}.\n\nGenerate personalized talking points. Return JSON.',
          },
        ],
      },
      outputExtractor: {
        personalized_insights: 'choices.0.message.content',
      },
      onError: 'skip',
    },
  ],
  estimatedCostCents: { min: 5, max: 15 },
  providers: ['openai'],
}
