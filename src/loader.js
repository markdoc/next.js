const fs = require('fs');
const path = require('path');
const Markdoc = require('@markdoc/markdoc');

const DEFAULT_SCHEMA_PATH = './markdoc';

function normalize(s) {
  return s.replace(/\\/g, path.win32.sep.repeat(2));
}

async function gatherPartials(ast, schemaDir, tokenizer) {
  let partials = {};

  for (const node of ast.walk()) {
    const file = node.attributes.file;

    if (
      node.type === 'tag' &&
      node.tag === 'partial' &&
      typeof file === 'string' &&
      !partials[file]
    ) {
      const filepath = path.join(schemaDir, file);
      // parsing is not done here because then we have to serialize and reload from JSON at runtime
      const content = await fs.promises.readFile(filepath, {encoding: 'utf8'});

      if (content) {
        const tokens = tokenizer.tokenize(content);
        const ast = Markdoc.parse(tokens);
        partials = {
          ...partials,
          [file]: content,
          ...(await gatherPartials.call(this, ast, schemaDir, tokenizer)),
        };
      }
    }
  }

  return partials;
}

// Returning a JSX object is what allows fast refresh to work
async function load(source) {
  // https://webpack.js.org/concepts/module-resolution/
  const resolve = this.getResolve({
    // https://webpack.js.org/api/loaders/#thisgetresolve
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx', '...'],
    preferRelative: true,
  });

  const {
    dir, // Root directory from Next.js (contains next.config.js)
    mode = 'static',
    schemaPath = DEFAULT_SCHEMA_PATH,
    tokenizerOptions = undefined,
  } = this.getOptions() || {};

  const tokenizer = new Markdoc.Tokenizer(tokenizerOptions);

  const schemaDir = path.resolve(dir, schemaPath || DEFAULT_SCHEMA_PATH);
  const tokens = tokenizer.tokenize(source);
  const ast = Markdoc.parse(tokens);

  // Grabs the path of the file relative to the `/pages` directory
  // to pass into the app props later.
  // This array access @ index 1 is safe since Next.js guarantees that
  // all pages will be located under either pages/ or src/pages/
  // https://nextjs.org/docs/advanced-features/src-directory
  const filepath = this.resourcePath.split('pages')[1];

  const partials = await gatherPartials.call(
    this,
    ast,
    path.resolve(schemaDir, 'partials'),
    tokenizer
  );

  // IDEA: consider making this an option per-page
  const dataFetchingFunction =
    mode === 'server' ? 'getServerSideProps' : 'getStaticProps';

  let schemaCode = 'const schema = {};';
  try {
    const directoryExists = await fs.promises.stat(schemaDir);

    // This creates import strings that cause the config to be imported runtime
    async function importAtRuntime(variable) {
      try {
        const module = await resolve(schemaDir, variable);
        return `import * as ${variable} from '${normalize(module)}'`;
      } catch (error) {
        return `const ${variable} = {};`;
      }
    }

    if (directoryExists) {
      schemaCode = `
        ${await importAtRuntime('config')}
        ${await importAtRuntime('tags')}
        ${await importAtRuntime('nodes')}
        ${await importAtRuntime('functions')}
        const schema = {
          tags: defaultObject(tags),
          nodes: defaultObject(nodes),
          functions: defaultObject(functions),
          ...defaultObject(config),
        };`
        .trim()
        .replace(/^\s+/gm, '');
    }
  } catch (error) {
    // Only throw module not found errors if user is passing a custom schemaPath
    if (schemaPath && schemaPath !== DEFAULT_SCHEMA_PATH) {
      throw new Error(`Cannot find module '${schemaPath}' at '${schemaDir}'`);
    }
  }

  this.addContextDependency(schemaDir);
  const result = `import React from 'react';
import yaml from 'js-yaml';
// renderers is imported separately so Markdoc isn't sent to the client
import Markdoc, {renderers} from '@markdoc/markdoc'

import {getSchema, defaultObject} from '${normalize(
    await resolve(__dirname, './runtime')
  )}';
/**
 * Schema is imported like this so end-user's code is compiled using build-in babel/webpack configs.
 * This enables typescript/ESnext support
 */
${schemaCode}

const tokenizer = new Markdoc.Tokenizer(${
    tokenizerOptions ? JSON.stringify(tokenizerOptions) : ''
  });

/**
 * Source will never change at runtime, so parse happens at the file root
 */
const source = ${JSON.stringify(source)};
const filepath = ${JSON.stringify(filepath)};
const tokens = tokenizer.tokenize(source);
const ast = Markdoc.parse(tokens);

/**
 * Like the AST, frontmatter won't change at runtime, so it is loaded at file root.
 * This unblocks future features, such a per-page dataFetchingFunction.
 */
const frontmatter = ast.attributes.frontmatter
  ? yaml.load(ast.attributes.frontmatter)
  : {};

const {components, ...rest} = getSchema(schema)

export async function ${dataFetchingFunction}(context) {
  const partials = ${JSON.stringify(partials)};

  // Ensure Node.transformChildren is available
  Object.keys(partials).forEach((key) => {
    const tokens = tokenizer.tokenize(partials[key]);
    partials[key] = Markdoc.parse(tokens);
  });

  const cfg = {
    ...rest,
    variables: {
      ...(rest ? rest.variables : {}),
      // user can't override this namespace
      markdoc: {frontmatter},
      // Allows users to eject from Markdoc rendering and pass in dynamic variables via getServerSideProps
      ...(context.variables || {})
    },
    partials,
    source,
  };

  /**
   * transform must be called in dataFetchingFunction to support server-side rendering while
   * accessing variables on the server
   */
  const content = await Markdoc.transform(ast, cfg);

  return {
    // Removes undefined
    props: JSON.parse(
      JSON.stringify({
        markdoc: {
          content,
          frontmatter,
          file: {
            path: filepath
          }
        },
      })
    ),
  };
}

export default function MarkdocComponent(props) {
  // Only execute HMR code in development
  return renderers.react(props.markdoc.content, React, {
    components: {
      ...components,
      // Allows users to override default components at runtime, via their _app
      ...props.components,
    },
  });
}
`;
  return result;
}

module.exports = async function loader(source) {
  const callback = this.async();
  try {
    const result = await load.call(this, source);
    callback(null, result);
  } catch (error) {
    console.error(error);
    callback(error);
  }
};
