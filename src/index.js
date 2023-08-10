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
                ...pluginOptions,
                dir: options.dir,
                nextRuntime: options.nextRuntime,
                appDir:
                  options.config.experimental.appDir &&
                  options.defaultLoaders.babel.options.appDir,
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
