const vm = require('vm');
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');
const React = require('react');
const enhancedResolve = require('enhanced-resolve');
const loader = require('../src/loader');

const source = fs.readFileSync(require.resolve('./fixture.md'), 'utf-8');

// https://stackoverflow.com/questions/53799385/how-can-i-convert-a-windows-path-to-posix-path-using-node-path
function normalizeAbsolutePath(s) {
  return s
    .replace(/^[a-zA-Z]:/, '') // replace C: for Windows
    .split(path.sep)
    .join(path.posix.sep);
}

function normalizeOperatingSystemPaths(s) {
  return s
    .replace(normalizeAbsolutePath(process.cwd()), '.')
    .split(path.sep)
    .join(path.posix.sep)
    .replace(/\/r\/n/g, '\\n');
}

function evaluate(output) {
  const {code} = babel.transformSync(output);
  const exports = {};

  // https://stackoverflow.com/questions/38332094/how-can-i-mock-webpacks-require-context-in-jest
  require.context = require.context = (base = '.') => {
    const files = [];

    function readDirectory(directory) {
      fs.readdirSync(directory).forEach((file) => {
        const fullPath = path.resolve(directory, file);

        if (fs.statSync(fullPath).isDirectory()) {
          readDirectory(fullPath);
        }

        files.push(fullPath);
      });
    }

    readDirectory(path.resolve(__dirname, base));

    return Object.assign(require, {keys: () => files});
  };

  vm.runInNewContext(code, {
    exports,
    require,
    console,
  });

  return exports;
}

function options(config = {}) {
  const webpackThis = {
    context: __dirname,
    getOptions() {
      return {
        ...config,
        dir: __dirname,
        nextRuntime: 'nodejs',
      };
    },
    getLogger() {
      return console;
    },
    addDependency() {},
    addContextDependency() {},
    getResolve: (options) => {
      const resolve = enhancedResolve.create(options);
      return async (context, file) =>
        new Promise((res, rej) =>
          resolve(context, file, (err, result) =>
            err ? rej(err) : res(result)
          )
        ).then(normalizeAbsolutePath);
    },
    resourcePath: '/Users/someone/a-next-js-repo/pages/test/index.md',
  };

  return webpackThis;
}

async function callLoader(config, source) {
  return new Promise((res, rej) => {
    config.async = () => (error, result) => {
      if (error) {
        rej(error);
      } else {
        res(result);
      }
    };
    loader.call(config, source);
  });
}

test('should not fail build if default `schemaPath` is used', async () => {
  await expect(callLoader(options(), source)).resolves.toEqual(
    expect.any(String)
  );
});

test('should fail build if invalid `schemaPath` is used', async () => {
  await expect(
    callLoader(options({schemaPath: 'unknown_schema_path'}), source)
  ).rejects.toThrow("Cannot find module 'unknown_schema_path'");
});

test('file output is correct', async () => {
  const output = await callLoader(options(), source);

  expect(normalizeOperatingSystemPaths(output)).toMatchSnapshot();

  const page = evaluate(output);

  expect(evaluate(output)).toEqual({
    default: expect.any(Function),
    getStaticProps: expect.any(Function),
  });

  const data = await page.getStaticProps({});
  expect(data.props.markdoc).toEqual({
    content: {
      $$mdtype: 'Tag',
      name: 'article',
      attributes: {},
      children: [
        {
          $$mdtype: 'Tag',
          name: 'h1',
          attributes: {},
          children: ['Custom title'],
        },
      ],
    },
    frontmatter: {
      title: 'Custom title',
    },
    file: {
      path: '/test/index.md',
    },
  });

  expect(page.default(data.props)).toEqual(
    React.createElement(
      'article',
      undefined,
      React.createElement('h1', undefined, 'Custom title')
    )
  );
});

test.each([
  [undefined, undefined],
  ['./schemas/folders', 'markdoc1'],
  ['./schemas/folders/', 'markdoc1'],
  ['./schemas/files', 'markdoc2'],
  ['schemas/files', 'markdoc2'],
  ['schemas/typescript', source],
])('Custom schema path ("%s")', async (schemaPath, expectedChild) => {
  const output = await callLoader(options({schemaPath}), source);

  const page = evaluate(output);

  const data = await page.getStaticProps({});
  expect(data.props.markdoc.content.children[0].children[0]).toEqual(
    'Custom title'
  );
  expect(data.props.markdoc.content.children[1]).toEqual(expectedChild);
});

test('Partials', async () => {
  const output = await callLoader(
    options({schemaPath: './schemas/partials'}),
    `${source}\n{% partial file="footer.md" /%}`
  );

  const page = evaluate(output);

  const data = await page.getStaticProps({});
  expect(data.props.markdoc.content.children[1].children[0]).toEqual('footer');
});

test('Ejected config', async () => {
  const output = await callLoader(
    options({schemaPath: './schemas/ejectedConfig'}),
    `${source}\n{% $product %}`
  );

  const page = evaluate(output);

  const data = await page.getStaticProps({});
  expect(data.props.markdoc.content.children[1]).toEqual('Extra value');
  expect(data.props.markdoc.content.children[2].children[0]).toEqual('meal');
});

test('HMR', async () => {
  const output = await callLoader(
    {
      ...options(),
      hot: true,
    },
    source
  );

  expect(normalizeOperatingSystemPaths(output)).toMatchSnapshot();
});

test('mode="server"', async () => {
  const output = await callLoader(options({mode: 'server'}), source);

  expect(evaluate(output)).toEqual({
    default: expect.any(Function),
    getServerSideProps: expect.any(Function),
  });
});
