const { resolve } = require('path');
const { writeFile } = require('fs');
const sm = require('sitemap');
const walk = require('fs-walk').walkSync;
const collection = require('./collection');

/*
 * Recursively walk a directory and call a function on all its json files.
 * Imported file and absolute path are the parameters passed to
 * the callback function.
 */
const walkDir = (dirname, fn) => {
  walk(dirname, (basedir, filename, stat) => {
    const absPath = resolve('./', basedir, filename);

    if (stat.isDirectory()) {
      return walkDir(absPath, fn);
    }

    if (typeof fn === 'function' && absPath.endsWith('.json')) {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      fn(require(absPath), absPath);
    }

    return null;
  });
};

collection('maps', (db, coll) => {
  // Used to check when mongoDB is done inserting maps.
  let insertsPending = 0;

  // Used for generating the sitemap.
  const sitemap = sm.createSitemap({ hostname: 'https://learn-anything.xyz' });
  sitemap.add({ url: '/' });

  /*
   * Get all maps from DB, in the format { key, title },
   * and write them into the triggers file on the client/utils folder.
   */
  const createTriggers = () => {
    coll.find({}, { key: 1, title: 1, _id: 0 }).toArray()
      .then((result) => {
        writeFile('client/utils/triggers.json', JSON.stringify(result), (err) => {
          if (err) {
            throw err;
          }

          db.close();
        });
      });
  };

  // Insert all maps from the maps folder to the maps collection.
  walkDir('maps', (map) => {
    const parsedMap = Object.assign({}, map);

    // Set the map key for search. If there's a tag use that,
    // otherwise use the leftmost topic on the title.
    if (map.tag) {
      parsedMap.key = map.tag;
    } else {
      const splitTitle = map.title.split(' - ');
      parsedMap.key = splitTitle[splitTitle.length - 1];
    }

    // Convert all spaces in the title with dashes.
    parsedMap.title = parsedMap.title.replace('learn anything - ', '').replace(/ /g, '-');

    // Add url of current map to sitemap.
    const url = `/${parsedMap.title.replace(/---/g, '/')}/`;
    sitemap.add({ url });

    if (parsedMap.title === '') {
      parsedMap.title = 'learn-anything';
    }

    insertsPending += 1;

    coll.updateOne({ title: parsedMap.title }, { $set: parsedMap }, { upsert: true })
      .then(() => {
        insertsPending -= 1;

        if (insertsPending === 0) {
          createTriggers();
        }
      })
      .catch((err) => {
        insertsPending = 0;
        throw err;
      });
  });

  writeFile('sitemap.xml', sitemap.toString());
});
