const withMarkdoc =
  (pluginOptions = {}) =>
  (nextConfig = {}) => {
    return Object.assign({}, nextConfig, {
      webpack(config, options) {
        config.module.rules.push({
          test: pluginOptions.extension || /\.(md|mdoc)$/,
          use: [
            // Adding the babel loader enables fast refresh
            options.defaultLoaders.babel,
            {
              loader: require.resolve('./loader'),
              options: {
                appDir: options.defaultLoaders.babel.options.appDir,
                pagesDir: options.defaultLoaders.babel.options.pagesDir,
                ...pluginOptions,
                dir: options.dir,
                nextRuntime: options.nextRuntime,
              },
            },
          ],
        });

        if (typeof nextConfig.webpack === 'function') {
          return nextConfig.webpack(config, options);
        }

        return config;
      },
    });
  };

module.exports = withMarkdoc;
