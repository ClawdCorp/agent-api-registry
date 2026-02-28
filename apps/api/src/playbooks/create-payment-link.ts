import type { PlaybookManifest } from '../core/playbook-schema.js'

export const createPaymentLinkPlaybook: PlaybookManifest = {
  id: 'create-payment-link',
  version: '1.0.0',
  name: 'Create Payment Link',
  description:
    'Create a Stripe product, price, and shareable payment link in one step',
  author: 'aar-platform',
  industry: ['ecommerce', 'saas', 'freelance'],
  inputSchema: {
    type: 'object',
    required: ['product_name', 'price_cents'],
    properties: {
      product_name: {
        type: 'string',
        description: 'Name of the product',
      },
      price_cents: {
        type: 'number',
        description: 'Price in cents (e.g., 2999 for $29.99)',
      },
      currency: {
        type: 'string',
        default: 'usd',
        description: 'Currency code',
      },
      description: {
        type: 'string',
        description: 'Product description (optional)',
      },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      product_id: { type: 'string' },
      price_id: { type: 'string' },
      payment_link_url: { type: 'string' },
      payment_link_id: { type: 'string' },
    },
  },
  steps: [
    {
      id: 'create-product',
      provider: 'stripe',
      method: 'POST',
      path: 'v1/products',
      bodyTemplate: {
        name: '{{input.product_name}}',
        description: '{{input.description}}',
      },
      outputExtractor: {
        product_id: 'id',
      },
      onError: 'fail',
    },
    {
      id: 'create-price',
      provider: 'stripe',
      method: 'POST',
      path: 'v1/prices',
      bodyTemplate: {
        product: '{{steps.create-product.product_id}}',
        unit_amount: '{{input.price_cents}}',
        currency: '{{input.currency}}',
      },
      outputExtractor: {
        price_id: 'id',
      },
      onError: 'fail',
    },
    {
      id: 'create-payment-link',
      provider: 'stripe',
      method: 'POST',
      path: 'v1/payment_links',
      bodyTemplate: {
        'line_items[0][price]': '{{steps.create-price.price_id}}',
        'line_items[0][quantity]': 1,
      },
      outputExtractor: {
        payment_link_url: 'url',
        payment_link_id: 'id',
      },
      onError: 'fail',
    },
  ],
  estimatedCostCents: { min: 0, max: 0 },
  providers: ['stripe'],
}
