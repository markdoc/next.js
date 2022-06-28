const fs = require('fs');
const path = require('path');
const Markdoc = require('@markdoc/markdoc');

const DEFAULT_SCHEMA_PATH = './markdoc';

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
  const logger = this.getLogger('@markdoc/next.js');
  // https://webpack.js.org/concepts/module-resolution/
  const resolve = this.getResolve({
    // https://webpack.js.org/api/loaders/#thisgetresolve
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx', '...'],
    preferRelative: true,
  });

  const {mode = 'static', schemaPath = DEFAULT_SCHEMA_PATH} =
    this.getOptions() || {};

  const schemaDir = path.resolve(schemaPath || DEFAULT_SCHEMA_PATH);

  // Grabs the path of the file relative to the `/pages` directory
  // to pass into the app props later.
  // This array access @ index 1 is safe since Next.js guarantees that
  // all pages will be located under either pages/ or src/pages/
  // https://nextjs.org/docs/advanced-features/src-directory
  const filepath = this.resourcePath.split('pages')[1];

  const ast = Markdoc.parse(source);

  const errors = Markdoc.validate(ast)
    // tags are not yet registered, so ignore these errors
    .filter((e) => e.error.id !== 'tag-undefined')
    .filter((e) => {
      switch (e.error.level) {
        case 'debug':
        case 'error':
        case 'info': {
          logger[e.error.level](e.error.message);
          break;
        }
        case 'warning': {
          logger.warn(e.error.message);
          break;
        }
        case 'critical': {
          logger.error(e.error.message);
          break;
        }
        default: {
          logger.log(e.error.message);
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

    async function readDir(variable) {
      try {
        const module = await resolve(schemaDir, variable);
        return `import * as ${variable} from '${module}'`;
      } catch (error) {
        return `const ${variable} = {};`;
      }
    }

    if (directoryExists) {
      schemaCode = `
        ${await readDir('config')}
        ${await readDir('tags')}
        ${await readDir('nodes')}
        ${await readDir('functions')}
        const schema = {
          tags: tags ? (tags.default || tags) : {},
          nodes: nodes ? (nodes.default || nodes) : {},
          functions: functions ? (functions.default || functions) : {},
          ...(config ? (config.default || config) : {}),
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

import {getSchema} from '${await resolve(__dirname, './runtime')}';
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
  const content = Markdoc.transform(ast, cfg);

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
    console.log(error);
    callback(error);
  }
};
