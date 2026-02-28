import type { PlaybookManifest } from '../core/playbook-schema.js'

export const sendColdEmailPlaybook: PlaybookManifest = {
  id: 'send-cold-email',
  version: '1.0.0',
  name: 'Send Cold Email',
  description:
    'Generate a personalized cold email using AI and send it via Resend',
  author: 'aar-platform',
  industry: ['sales', 'marketing'],
  inputSchema: {
    type: 'object',
    required: [
      'recipient_email',
      'recipient_name',
      'recipient_company',
      'sender_context',
    ],
    properties: {
      recipient_email: {
        type: 'string',
        description: 'Recipient email address',
      },
      recipient_name: {
        type: 'string',
        description: 'Recipient full name',
      },
      recipient_company: {
        type: 'string',
        description: 'Recipient company name',
      },
      sender_context: {
        type: 'string',
        description: 'What the sender does/offers',
      },
      tone: {
        type: 'string',
        enum: ['professional', 'casual', 'direct'],
        default: 'professional',
      },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      email_subject: { type: 'string' },
      email_body: { type: 'string' },
      message_id: { type: 'string' },
      send_status: { type: 'string' },
    },
  },
  steps: [
    {
      id: 'generate-email',
      provider: 'openai',
      method: 'POST',
      path: 'v1/chat/completions',
      bodyTemplate: {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are an expert cold email copywriter. Generate a personalized cold email. Return ONLY a JSON object with "subject" and "body" keys. The body should be HTML formatted.',
          },
          {
            role: 'user',
            content:
              'Write a {{input.tone}} cold email to {{input.recipient_name}} at {{input.recipient_company}}. The sender offers: {{input.sender_context}}. Return JSON with "subject" and "body" keys.',
          },
        ],
      },
      outputExtractor: {
        email_subject: 'choices.0.message.content',
        raw_response: 'choices.0.message.content',
      },
      onError: 'fail',
    },
    {
      id: 'send-email',
      provider: 'resend',
      method: 'POST',
      path: 'emails',
      bodyTemplate: {
        from: 'noreply@aar.dev',
        to: '{{input.recipient_email}}',
        subject: 'Cold outreach to {{input.recipient_name}}',
        html: '{{steps.generate-email.raw_response}}',
      },
      outputExtractor: {
        message_id: 'id',
      },
      onError: 'fail',
    },
  ],
  estimatedCostCents: { min: 2, max: 5 },
  providers: ['openai', 'resend'],
}
