export default function Page() {
  return (
    <main style={{ fontFamily: 'Inter, sans-serif', padding: 24 }}>
      <h1>agent api registry</h1>
      <p>mvp monorepo starter is live.</p>
      <ul>
        <li>api: /health on :4000</li>
        <li>web: next.js app on :3000</li>
        <li>sdk: typed client in packages/sdk</li>
      </ul>
    </main>
  )
}
