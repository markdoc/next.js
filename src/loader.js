const fs = require('fs');
const path = require('path');
const Markdoc = require('@markdoc/markdoc');
const {defaultObject} = require('./runtime');

const DEFAULT_SCHEMA_PATH = './markdoc';
const BUILD_IMPORT_TIMEOUT = 5000;

function normalize(s) {
  return s.replace(/\\/g, path.win32.sep.repeat(2));
}

async function gatherPartials(ast, schemaDir) {
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
        const ast = Markdoc.parse(content);
        partials = {
          ...partials,
          [file]: content,
          ...(await gatherPartials.call(this, ast, schemaDir)),
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
    nextRuntime,
  } = this.getOptions() || {};

  const schemaDir = path.resolve(dir, schemaPath || DEFAULT_SCHEMA_PATH);
  const ast = Markdoc.parse(source);

  // Grabs the path of the file relative to the `/pages` directory
  // to pass into the app props later.
  // This array access @ index 1 is safe since Next.js guarantees that
  // all pages will be located under either pages/ or src/pages/
  // https://nextjs.org/docs/advanced-features/src-directory
  const filepath = this.resourcePath.split('pages')[1];

  // Only run validation when during server compilation
  if (nextRuntime === 'nodejs') {
    // This is just to get subcompilation working with Next.js's fast refresh
    let previousRequire = global.require;
    global.require = previousRequire || require || __non_webpack_require__;

    // This imports the config as an in-memory object
    const importAtBuildTime = async (resource) => {
      try {
        const object = await Promise.race([
          this.importModule(await resolve(schemaDir, resource)),
          new Promise((r, reject) => setTimeout(reject, BUILD_IMPORT_TIMEOUT)),
        ]);
        return defaultObject(object);
      } catch (error) {
        return undefined;
      }
    };

    const cfg = {
      tags: await importAtBuildTime('tags'),
      nodes: await importAtBuildTime('nodes'),
      functions: await importAtBuildTime('functions'),
      ...(await importAtBuildTime('config')),
    };

    const errors = Markdoc.validate(ast, cfg)
      // tags are not yet registered, so ignore these errors
      .filter((e) => e.error.id !== 'tag-undefined')
      .filter((e) => {
        switch (e.error.level) {
          case 'debug':
          case 'error':
          case 'info': {
            console[e.error.level](e.error.message);
            break;
          }
          case 'warning': {
            console.warn(e.error.message);
            break;
          }
          case 'critical': {
            console.error(e.error.message);
            break;
          }
          default: {
            console.log(e.error.message);
            break;
          }
        }
        return e.error.level === 'critical';
      })
      .flatMap((e) => {
        const lines = source.split('\n');

        const message = [e.error.message, ...lines.slice(...e.lines)];

        if (
          e.error &&
          e.error.location &&
          e.error.location.start &&
          e.error.location.start.offset
        ) {
          const prev = lines.slice(0, e.lines[0]).join('\n').length;
          const diff = e.error.location.start.offset - prev;

          const pointer = `${' '.repeat(diff)}^`;
          message.push(pointer);
        }

        // add extra newline between errors
        message.push('');
        return message;
      });

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }

    global.require = previousRequire;
  }

  const partials = await gatherPartials.call(
    this,
    ast,
    path.resolve(schemaDir, 'partials')
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

/**
 * Source will never change at runtime, so parse happens at the file root
 */
const source = ${JSON.stringify(source)};
const filepath = ${JSON.stringify(filepath)};
const ast = Markdoc.parse(source);

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
    partials[key] = Markdoc.parse(partials[key]);
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
