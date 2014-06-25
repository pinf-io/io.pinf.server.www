
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs-extra");
const EXPRESS = require("express");
const EXPRESS_SESSION = require("express-session");
const SEND = require("send");
const REQUEST = require("request");
const HTTP_PROXY = require("http-proxy");
const DOT = require("dot");
const PIO = require("pio");
const DEEPMERGE = require("deepmerge");
const DEEPCOPY = require("deepcopy");
const CONNECT_MEMCACHED = require("connect-memcached");
const MEMCACHED = require('memcached');
const COOKIE_PARSER = require("cookie-parser");
const BODY_PARSER = require("body-parser");
const SERVE_FAVICON = require("serve-favicon");
const MORGAN = require("morgan");
const METHOD_OVERRIDE = require("method-override");
const RETHINKDB = require("rethinkdb");
const WAITFOR = require("waitfor");
const Q = require("q");


var PORT = process.env.PORT || 8080;


exports.for = function(module, packagePath, preAutoRoutesHandler, postAutoRoutesHandler, appCreatorHandler) {

	var exports = module.exports;

	exports.main = function(callback) {

		return PIO.forPackage(packagePath).then(function(pio) {

			try {

				var documentRootPath = "www";
				if (
					pio._config.config["pio.service"].config &&
					pio._config.config["pio.service"].config['io.pinf.server.www'] &&
					pio._config.config["pio.service"].config['io.pinf.server.www'].documentRootPath
				) {
					documentRootPath = pio._config.config["pio.service"].config['io.pinf.server.www'].documentRootPath;
				}

				console.log("Using document root path:", documentRootPath);

			    var app = null;
			    if (appCreatorHandler) {
			    	app = appCreatorHandler(pio._config.config["pio.service"], {
		        		API: {
		        			EXPRESS: EXPRESS,
							DEEPMERGE: DEEPMERGE,
							WAITFOR: WAITFOR,
							Q: Q
		        		}
		        	});
				} else {
					app = EXPRESS();
				}
			    var proxy = HTTP_PROXY.createProxyServer({});

		        app.use(MORGAN());
//		        app.use(SERVE_FAVICON());
		        app.use(COOKIE_PARSER());
		        app.use(BODY_PARSER());
		        app.use(METHOD_OVERRIDE());
				if (
					pio._config.config["pio.service"].config &&
					pio._config.config["pio.service"].config.memcachedHost
				) {
					app.use(EXPRESS_SESSION({
						secret: 'session secret',
						key: 'sid',
						proxy: 'true',
						store: new (CONNECT_MEMCACHED(EXPRESS_SESSION))({
							prefix: "io.pinf.server.www-",
							hosts: [
								pio._config.config["pio.service"].config.memcachedHost
							]
						})
					}));
				}
				var r = null;
				if (
					pio._config.config["pio.service"].config &&
					pio._config.config["pio.service"].config.rethinkdbHost
				) {
					r = Object.create(RETHINKDB);
					var tableEnsure__pending = [];
				    r.tableEnsure = function (DB_NAME, TABLE_NAME, tableSuffix, options, callback, _previous) {
				    	if (typeof options === "function") {
				    		_previous = callback;
				    		callback = options;
				    		options = null;
				    	}
				    	options = options || {};
				    	if (tableEnsure__pending !== false) {
				    		tableEnsure__pending.push([DB_NAME, TABLE_NAME, tableSuffix, options, callback, _previous]);
				    		return;
				    	}
				        return r.db(DB_NAME).table(TABLE_NAME + "__" + tableSuffix).run(r.conn, function(err) {
				            if (err) {
				                if (/Database .+? does not exist/.test(err.msg)) {
				                    if (_previous === "dbCreate") return callback(err);
				                    return r.dbCreate(DB_NAME).run(r.conn, function (err) {
				                        if (err) {
							                if (/Database .+? already exists/.test(err.msg)) {
							                	// Ignore. Someone else beat us to it!
							                } else {
					                        	return callback(err);
							                }
				                        }
				                        return r.tableEnsure(DB_NAME, TABLE_NAME, tableSuffix, options, callback, "dbCreate");
				                    });
				                }
				                if (/Table .+? does not exist/.test(err.msg)) {
				                    if (_previous === "tableCreate") return callback(err);
				                    return r.db(DB_NAME).tableCreate(TABLE_NAME + "__" + tableSuffix).run(r.conn, function (err) {
				                        if (err) {
							                if (/Table .+? already exists/.test(err.msg)) {
							                	// Ignore. Someone else beat us to it!
							                } else {
					                        	return callback(err);
							                }
				                        }
				                        return r.tableEnsure(DB_NAME, TABLE_NAME, tableSuffix, options, callback, "tableCreate");
				                    });
				                }
				                return callback(err);
				            }
				            function ensureIndexes(callback) {
					            if (!options.indexes) {
					            	return callback(null);
					            }					            
					            return r.db(DB_NAME).table(TABLE_NAME + "__" + tableSuffix).indexList().run(r.conn, function (err, result) {
					                if (err) return callback(err);
						            var waitfor = WAITFOR.parallel(callback);
						            options.indexes.forEach(function(indexName) {
						            	if (result.indexOf(indexName) !== -1) {
						            		return;
						            	}
						            	waitfor(function(callback) {
						            		console.log("Creating index", indexName, "on table", TABLE_NAME + "__" + tableSuffix);
								            return r.db(DB_NAME).table(TABLE_NAME + "__" + tableSuffix).indexCreate(indexName).run(r.conn, function (err, result) {
						                        if (err) {
									                if (/Index .+? already exists/.test(err.msg)) {
									                	// Ignore. Someone else beat us to it!
									                } else {
							                        	return callback(err);
									                }
						                        }
							            		return callback(null);
							            	});
						            	});
						            });
						            return waitfor();
						        });
				            }
				            return ensureIndexes(function(err) {
				            	if (err) return callback(err);
					            return callback(null, r.db(DB_NAME).table(TABLE_NAME + "__" + tableSuffix));
				            });
				        });
				    }
				    r.getCached = function (DB_NAME, TABLE_NAME, tableSuffix, key, callback) {
				        return r.tableEnsure(DB_NAME, TABLE_NAME, tableSuffix, function(err, table) {
				            if (err) return callback(err);
				            return table.get(key).run(r.conn, function (err, result) {
				                if (err) return callback(err);
				                if (result) {
				//                    console.log("Using cached data for key '" + key + "':", result.data);
				                    return callback(null, result.data);
				                }
				                return callback(null, null, function (data, callback) {
				                    return table.insert({
				                        id: key,
				                        data: data
				                    }, {
				                        upsert: true
				                    }).run(r.conn, function (err, result) {
				                        if (err) return callback(err);
				                        return callback(null, data);
				                    });
				                });
				            });
				        });
				    }
					RETHINKDB.connect({
						host: pio._config.config["pio.service"].config.rethinkdbHost.split(":")[0],
						port: parseInt(pio._config.config["pio.service"].config.rethinkdbHost.split(":")[1])
					}, function(err, conn) {
						if(err) {
							console.error("Error connecting to RethinkDB host: " + pio._config.config["pio.service"].config.rethinkdbHost, err);
							return;
					  	}
  						r.conn = conn;

						console.log("Now that DB is connected run pending queries ...");
						var pending = tableEnsure__pending;
						tableEnsure__pending = false;
						pending.forEach(function (call) {
							r.tableEnsure.apply(r, call);
						});
					});
					app.use(function(req, res, next) {
						if (r) {
							res.r = r;
						}
						return next();
					});
				}
				app.use(function(req, res, next) {
					if (!req.headers["x-session-url"]) {
						return next();
					}
					// TODO: Cache for some time.
	                return REQUEST({
	                    url: req.headers["x-session-url"],
	                    headers: {
	                        "Accept": "application/json"
	                    }
	                }, function(err, _res, body) {
	                    if (err) return callback(err);
	                    if (
	                    	_res.statusCode === 200 &&
	                    	body && (body = JSON.parse(body)) &&
	                    	body["$status"] === 200
                    	) {
                    		delete body.$status;
							if (req.session) {
	                    		req.session.authorized = body;
	                    	}
	                    	if (!res.view) {
	                    		res.view = {};
	                    	}
	                    	res.view.authorized = body;
                    	}
						return next();
	                });
				});
		        if (preAutoRoutesHandler) {
		        	preAutoRoutesHandler(app, pio._config.config["pio.service"], {
		        		API: {
		        			EXPRESS: EXPRESS,
							DEEPMERGE: DEEPMERGE,
							WAITFOR: WAITFOR,
							Q: Q
		        		},
	        			r: r
		        	});
		        }

		        // Default routes inserted by config.

			    app.get("/favicon.ico", function (req, res, next) {
			    	return res.end();
			    });

		        if (postAutoRoutesHandler) {
		        	postAutoRoutesHandler(app, pio._config.config["pio.service"]);
		        }

			    function processRequest(requestConfig, req, res, next) {

		    		var pathname = req._parsedUrl.pathname;
		    		if (pathname === "/") pathname = "/index";

		    		// This is a standard route to echo a value specified as a query argument
		    		// back as a session cookie.
		    		// TODO: Standardize a route such as this.
		            if (pathname === "/.set-session-cookie" && req.query.sid) {
		                res.writeHead(204, {
		                    'Set-Cookie': 'x-pio-server-sid=' + req.query.sid,
		                    'Content-Type': 'text/plain',
		                    'Content-Length': "0"
		                });
		                return res.end();
		            }

		    		function formatPath(callback) {

		    			function checkExtensions(originalPath, callback) {
				    		return FS.exists(originalPath, function(exists) {
				    			if (/\/[^\/]+\.[^\.]+$/.test(pathname)) {
					    			return callback(null, originalPath, exists);
				    			}
				    			if (!exists) {
				    				var path = originalPath;
				    				if (pathname === "/index") {
				    					pathname += ".html";
				    					path += ".html";
				    				} else {
				    					pathname += ".htm";
				    					path += ".htm";
				    				}
						    		return FS.exists(path, function(exists) {
						    			return callback(null, path, exists);
						    		});
				    			}
				    			return callback(null, originalPath, true);
				    		});
		    			}

				    	if (!req.headers['x-theme']) {
			    			return checkExtensions(PATH.join(packagePath, documentRootPath, pathname), callback);
				    	}

			    		// Don't allow slashes in themes.
			    		// TODO: Use abstracted sanitizer.
			    		if (/\//.test(req.headers['x-theme'])) {
			    			res.writeHead(404);
			    			return res.end();
			    		}

			    		// TODO: Make themes path configurable.
			    		var path = PATH.join(packagePath, "themes", req.headers['x-theme']);
			    		return FS.exists(path, function(exists) {
			    			if (!exists) {
				    			res.writeHead(404);
				    			return res.end();
			    			}
			    			return checkExtensions(PATH.join(path, pathname), callback);
			    		});
		    		}

			    	return formatPath(function(err, path, pathExists) {
			    		if (err) return next(err);

		    			console.log("path", path, pathExists);
		    			if (pathExists) {
							if (
								req.headers['x-format'] === "tpl" ||
								!/\.html?/.test(path)
							) {
			    				// Serve local file.
								return SEND(req, PATH.basename(path))
									.root(PATH.dirname(path))
									.on('error', next)
									.pipe(res);
							}
							return FS.readFile(path, "utf8", function(err, templateSource) {
								if (err) return callback(err);

								// TODO: Get own instance: https://github.com/olado/doT/issues/112
	                            DOT.templateSettings.strip = false;
	                            DOT.templateSettings.varname = "view";
		                        var compiled = null;
		                        try {
		                            compiled = DOT.template(templateSource);
		                        } catch(err) {
									console.error("templateSource", templateSource);
		                        	console.error("Error compiling template: " + path);
		                            return callback(err);
		                        }

								var result = null;
	                            try {
	                                result = compiled(res.view || {});
	                            } catch(err) {
		                        	console.error("Error running compiled template: " + path);
		                            return next(err);
	                            }

	                            // TODO: Send proper headers.
	                            res.writeHead(200, {
	                            	"Content-Type": "text/html",
	                            	"Content-Length": result.length
	                            });
	                            return res.end(result);
							});
		    			}

		    			var overlayPath = PATH.join(packagePath, documentRootPath, pathname.replace(/(\.[^\/]+)$/, ".overlay$1"));

    					function loadOverlay(callback) {
				    		return FS.exists(overlayPath, function(overlayExists) {
				    			console.log("overlayPath", overlayPath, overlayExists);
				    			if (!overlayExists) {
				    				return callback(null, false);
				    			}
			    				return FS.readFile(overlayPath, "utf8", callback);
			    			});
    					}

    					function makeUpstreamRequests(pathname, sendConfig, callback) {
	    					if (
	    						!pio._config.config["pio.service"].config ||
	    						!pio._config.config["pio.service"].config.www ||
	    						!pio._config.config["pio.service"].config.www.extends
	    					) {
	    						return callback(null, null, null);
	    					}    						
    						// We call one URL after another until we get a 200 response at which point we stop.
			    			var urls = [].concat(pio._config.config["pio.service"].config.www.extends);
    						function makeRequest(upstreamInfo) {
								if (typeof upstreamInfo === "string") {
			    					upstreamInfo = {
			    						host: upstreamInfo
			    					};
			    				}
				    			console.log("upstreamInfo", upstreamInfo);
			    				var headers = {};
			    				if (upstreamInfo.theme) {
									headers["x-theme"] = upstreamInfo.theme;
									headers["x-format"] = "tpl";
			    				}
				    			var url = "http://" + upstreamInfo.host + pathname;
				    			var params = {
				    				url: url,
				    				headers: headers
				    			};
				    			if (sendConfig) {
				    				params.method = "POST";
				    				params.json = sendConfig;
				    				params.headers["x-config"] = "in-body";
				    			}
				    			return REQUEST(params, function(err, response, body) {
				    				if (err) {
				    					console.error("body", body);
				    					console.error("Error calling '" + url + "':", err.stack);
				    					err.message += " (while calling '" + url + "')";
				    					err.stack += "\n(while calling '" + url + "')";
				    					return callback(err);
				    				}
				    				response._url = url;
				    				if (response.statusCode === 404) {
				    					if (urls.length === 0) {
				    						return callback(null, response, null);
				    					}
				    					return makeRequest(urls.pop());
				    				}
				    				if (response.statusCode !== 200) return callback(new Error("Did not get status 200 when fetching from: " + url));
				    				return callback(null, response, body);
				    			});
    						}
    						return makeRequest(urls.pop());
    					}

    					function loadConfig(templateSource, callback) {

    						function loadLocal(callback) {
				    			var configPath = overlayPath.replace(/\.[^\.]+$/, ".json");
					    		return FS.exists(configPath, function(configExists) {
					    			console.log("configPath", configPath, configExists);
					    			if (!configExists) {
					    				return callback(null, false);
					    			}
					    			return FS.readJson(configPath, callback);
					    		});
    						}

    						return loadLocal(function(err, localConfig) {
    							if (err) return callback(err);

    							var config = requestConfig;
    							if (localConfig) {
    								config = DEEPMERGE(localConfig, config || {});
    							}
    							if (config === false) {
				    				return callback(null, config);
    							}

			    				return makeUpstreamRequests(pathname.replace(/(\.[^\/]+)$/, ".overlay.json"), null, function(err, response, body) {
			    					if (err) return next(err);
			    					if (!response) {
			    						return callback(null, config);
			    					}
			    					if (body) {
			    						config = DEEPMERGE(JSON.parse(body), config || {});
			    					}

//			    					console.log("Replace variables in config", config);

			    					var compiled = null;
		                            DOT.templateSettings.varname = "config";
			                        try {
			                            compiled = DOT.template(JSON.stringify(config));
			                        } catch(err) {
										console.error("config", JSON.stringify(config, null, 4));
			                        	console.error("Error compiling template: " + url);
			                            return next(err);
			                        }

		                            var result = null;
		                            try {
		                                result = compiled(pio._config.config);
		                            } catch(err) {
			                        	console.error("Error running compiled template: " + url);
			                            return next(err);
		                            }

		                            config = JSON.parse(result);


		    						return callback(null, config);
				    			});
		    				});
    					}

	    				function processOverlay(config, templateSource) {
		    				return makeUpstreamRequests(pathname, config, function(err, response, body) {
		    					if (err) return next(err);

		    					if (!response) {
		    						if (!templateSource) {
		    							// We found nothing upstream and have no template ourselves.
		    							return next();
		    						}
		    						// TODO: Turn into better help message.
		    						return callback(new Error("We have an overlay at '" + overlayPath + "' but there are no upstream servers configured! Please configure upstream servers!"));
		    					}

		    					if (response.statusCode === 404) {
		    						return callback(new Error("No upstream file found at url '" + response._url + "' even though we have an overlay at '" + overlayPath + "'! Remove the overlay or make sure the file is served by upstream server."));
		    					}

	                            // TODO: Get own instance: https://github.com/olado/doT/issues/112
	                            DOT.templateSettings.strip = false;
	                            DOT.templateSettings.varname = "at";
		                        var compiled = null;

		                        try {
		                            compiled = DOT.template(templateSource);
		                        } catch(err) {
									console.error("templateSource", templateSource);
		                        	console.error("Error compiling template: " + overlayPath);
		                            return next(err);
		                        }


		                        var anchors = {};
								var re = /\{\{=view\.anchor\.([^\}]+)\}\}/g;
								var m;
								while (m = re.exec(body)) {
									var at = DEEPCOPY(config);
									at.config = JSON.stringify(config);
									at[m[1]] = true;
		                            try {
		                            	console.log("Replacing variables in '" + overlayPath + "' with:", JSON.stringify(at, null, 4));
										anchors[m[1]] = compiled(at) || "";
		                            } catch(err) {
			                        	console.error("Error running compiled template: " + overlayPath);
			                            return next(err);
		                            }
								}


	                            DOT.templateSettings.varname = "view";
		                        try {
		                            compiled = DOT.template(body);
		                        } catch(err) {
									console.error("body", body);
		                        	console.error("Error compiling template: " + url);
		                            return next(err);
		                        }


	                            var result = null;
	                            try {
	                                result = compiled({
	                                	title: "Our Title",
	                                	anchor: anchors
	                                });
	                            } catch(err) {
		                        	console.error("Error running compiled template: " + url);
		                            return next(err);
	                            }

	                            // TODO: Send proper headers.
	                            res.writeHead(200, {
	                            	"Content-Type": response.headers["content-type"],
	                            	"Content-Length": result.length
	                            });
	                            return res.end(result);
			    			});
	    				}

	    				return loadOverlay(function(err, templateSource) {
	    					if (err) return next(err);

		    				return loadConfig(templateSource, function(err, config) {
		    					if (err) return next(err);

		    					if (templateSource || config) {
				    				return processOverlay(config, templateSource);
		    					}

		    					if (
		    						!pio._config.config["pio.service"].config ||
		    						!pio._config.config["pio.service"].config.www ||
		    						!pio._config.config["pio.service"].config.www.extends
		    					) {
		    						return next();
		    					}

				    			var urls = [].concat(pio._config.config["pio.service"].config.www.extends);
				    			function forwardUpstream(upstreamInfo) {
				    				if (typeof upstreamInfo === "string") {
				    					upstreamInfo = {
				    						host: upstreamInfo
				    					};
				    				}
				    				var headers = {};
				    				if (upstreamInfo.theme) {
										headers["x-theme"] = upstreamInfo.theme;
				    				}
									var url = "http://" + upstreamInfo.host + pathname;
				    				return REQUEST({
				    					url: url,
				    					method: "HEAD",
				    					headers: headers
				    				}, function(err, response, body) {
				    					if (err) {
											console.error("PROXY HEAD ERROR", err, err.stack);
				    						return next(err);
				    					}
				    					if (response.statusCode === 404) {
					    					if (urls.length === 0) return next();
					    					return forwardUpstream(urls.pop());
				    					}
					    				if (upstreamInfo.theme) {
							    			req.headers["x-theme"] = upstreamInfo.theme;
					    				}
							            return proxy.web(req, res, {
							                target: "http://" + upstreamInfo.host
							            }, function(err) {
											console.error("PROXY ERROR", err, err.stack);
							                if (err.code === "ECONNREFUSED") {
							                    res.writeHead(502);
							                    return res.end("Bad Gateway");
							                }
						                    res.writeHead(500);
						                    console.error(err.stack);
						                    return res.end("Internal Server Error");
							            });
				    				});
				    			}
				    			return forwardUpstream(urls.pop());
		    				});
	    				});
		    		});
			    }

			    app.post(/^\//, function(req, res, next) {
			    	if (req.headers["x-config"] === "in-body") {
						return processRequest(req.body, req, res, next);
			    	}
			    	return next();
			    });

			    app.get(/^\//, function(req, res, next) {
			    	return processRequest(false, req, res, next);
			    });

				var server = app.listen(PORT);

				console.log("Listening at: http://localhost:" + PORT);

			    return callback(null, {
			        server: server
			    });
			} catch(err) {
				return callback(err);
			}
		}).fail(callback);
	}

	if (require.main === module) {
		return exports.main(function(err) {
			if (err) {
				console.error(err.stack);
				process.exit(1);
			}
			// Keep server running.
		});
	}
}


exports.for(module, __dirname);

