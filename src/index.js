const withMarkdoc =
  (pluginOptions = {}) =>
  (nextConfig = {}) => {
    const extension = pluginOptions.extension || /\.(md|mdoc)$/;
    
    // Convert regex to string pattern for Turbopack
    const getExtensionPattern = (ext) => {
      if (ext instanceof RegExp) {
        // Extract extensions from regex pattern like /\.(md|mdoc)$/
        const match = ext.source.match(/\\\.\(([^)]+)\)\$?/);
        if (match) {
          return match[1].split('|').map(e => `*.${e}`);
        }
        // Fallback for other regex patterns
        return ['*.md', '*.mdoc'];
      }
      return [ext];
    };

    const extensionPatterns = getExtensionPattern(extension);
    
    // Create Turbopack rules for each extension pattern
    const turbopackRules = {};
    extensionPatterns.forEach(pattern => {
      turbopackRules[pattern] = {
        loaders: [
          {
            loader: require.resolve('./loader'),
            options: {
              ...pluginOptions,
            },
          },
        ],
        as: '*.js',
      };
    });

    return Object.assign({}, nextConfig, {
      webpack(config, options) {
        config.module.rules.push({
          test: extension,
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
      
      // Add Turbopack configuration
      turbopack: {
        ...nextConfig.turbopack,
        rules: {
          ...nextConfig.turbopack?.rules,
          ...turbopackRules,
        },
      },
    });
  };

module.exports = withMarkdoc;
