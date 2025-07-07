# `@markdoc/next.js`

> **Note**: this plugin will be treated as a beta version until `v1.0.0` is released.

Using the `@markdoc/next.js` plugin allows you to create custom `.md` and `.mdoc` pages in your Next.js apps, and automatically render them with [`markdoc`](https://github.com/markdoc/markdoc).

## Setup

The first thing you'll need to do is install `@markdoc/next.js` and add it to your project's config.

1. From your project, run this command to install `@markdoc/next.js`:
   ```sh
   npm install @markdoc/next.js @markdoc/markdoc
   ```
2. Open `next.config.js` and add the following code:

   ```js
   // next.config.js

   const withMarkdoc = require('@markdoc/next.js');

   module.exports = withMarkdoc(/* options */)({
     pageExtensions: ['js', 'md'],
   });
   ```

3. Create a new Markdoc file in `pages/docs` named `getting-started.md`.

   ```
   pages
   ├── _app.js
   ├── docs
   │   └── getting-started.md
   ├── index.js
   ```

4. Add some content to `getting-started.md`:

   ```md
   ---
   title: Get started with Markdoc
   description: How to get started with Markdoc
   ---

   # Get started with Markdoc
   ```

## Turbopack Support

This plugin now supports **Turbopack**, Next.js's new Rust-based bundler. The plugin automatically works with both webpack (default) and Turbopack without any configuration changes.

### Using with Turbopack

To use Turbopack in development, add the `--turbopack` flag to your dev script:

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start"
  }
}
```

The same `next.config.js` configuration works for both webpack and Turbopack:

```js
// next.config.js - Works with both webpack and Turbopack

const withMarkdoc = require('@markdoc/next.js');

module.exports = withMarkdoc({
  // Your Markdoc options here
  mode: 'static',
  schemaPath: './markdoc',
})({
  pageExtensions: ['js', 'md', 'mdoc'],
});
```

The plugin automatically detects whether you're using webpack or Turbopack and configures the appropriate loader system.

See [our docs](https://markdoc.dev/docs/nextjs) for more options.

## Contributing

Contributions and feedback are welcomed and encouraged. Feel free to open PRs here, or open issues in the [Markdoc core repo](https://github.com/markdoc/markdoc).

Follow these steps to set up the project:

1. Run `npm install`
1. Run `npm test`

## Code of conduct

This project has adopted the Stripe [Code of conduct](https://github.com/markdoc/markdoc/blob/main/.github/CODE_OF_CONDUCT.md).

## License

This project uses the [MIT license](LICENSE).
