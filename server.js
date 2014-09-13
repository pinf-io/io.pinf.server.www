
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs-extra");
const URL = require("url");
const QUERYSTRING = require("querystring");
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
const CRYPTO = require("crypto");


var PORT = process.env.PORT || 8080;

const DEBUG = true;

exports.for = function(module, packagePath, preAutoRoutesHandler, postAutoRoutesHandler, appCreatorHandler) {

	var exports = module.exports;

	var options = null;
	if (typeof postAutoRoutesHandler === "object") {
		options = postAutoRoutesHandler;
		postAutoRoutesHandler = null;
	}

	function addParamatersToUrl(url, paramaters) {
		var parsedUrl = URL.parse(url);
		delete parsedUrl.search;
		parsedUrl.query = QUERYSTRING.parse(parsedUrl.query);
		for (var name in paramaters) {
			parsedUrl.query[name] = paramaters[name];
		}
		return URL.format(parsedUrl);
	}

	exports.main = function(callback) {

	    var pioConfig = FS.readJsonSync(PATH.join(packagePath, "../.pio.json"));

	    var authCode = CRYPTO.createHash("sha1");
	    authCode.update(["auth-code", pioConfig.config.pio.instanceId, pioConfig.config.pio.instanceSecret].join(":"));
	    authCode = authCode.digest("hex");

		return PIO.forPackage(packagePath).then(function(pio) {
			if (
				!options ||
				!options.startupDelay
			) return pio;
			console.log("Delay startup by:", options.startupDelay);
			return Q.delay(options.startupDelay).then(function() {
				return pio;
			});
		}).then(function(pio) {

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
		        			FS: FS,
		        			EXPRESS: EXPRESS,
							DEEPMERGE: DEEPMERGE,
							WAITFOR: WAITFOR,
							Q: Q,
							REQUEST: REQUEST,
							SEND: SEND
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
					var originalSessionPrefix = "io.pinf.server.www-";
					var sessionStore = new (CONNECT_MEMCACHED(EXPRESS_SESSION))({
						prefix: originalSessionPrefix,
						hosts: [
							pio._config.config["pio.service"].config.memcachedHost
						]
					});
					app.use(EXPRESS_SESSION({
						secret: 'session secret',
						key: 'sid-' + PORT,
						proxy: 'true',
						store: sessionStore
					}));
					if (!app.helpers) {
						app.helpers = {};
					}
					app.helpers.destroyAllSessions = function() {
						sessionStore.prefix = originalSessionPrefix + Date.now() + "-";
					}
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
console.log("err.msg", err.msg);
							                if (/Database .+? already exists/.test(err.msg)) {
							                	// Ignore. Someone else beat us to it!
							                	console.error("Ignoring database exists error!");
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
console.log("err.msg", err.msg);
							                if (/Table .+? already exists/.test(err.msg)) {
							                	// Ignore. Someone else beat us to it!
							                	console.error("Ignoring table exists error!");
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
console.log("err.msg", err.msg);
									                if (/Index .+? already exists/.test(err.msg)) {
									                	// Ignore. Someone else beat us to it!
									                	console.error("Ignoring index exists error!");
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
				    function connectToRethinkDB() {
				    	function reconnect() {
				    		console.log("Reconnect scheduled ...");
				    		setTimeout(function () {
				    			connectToRethinkDB();
				    		}, 2000);
				    	}
				    	console.log("Try to connect to RethinkDB ...");
						RETHINKDB.connect({
							host: pio._config.config["pio.service"].config.rethinkdbHost.split(":")[0],
							port: parseInt(pio._config.config["pio.service"].config.rethinkdbHost.split(":")[1])
						}, function(err, conn) {
							if(err) {
								console.error("Error connecting to RethinkDB host: " + pio._config.config["pio.service"].config.rethinkdbHost, err);
								return reconnect();
						  	}
	  						r.conn = conn;

	  						conn.once("close", function () {
	  							console.log("DB connection closed!");
	  							return reconnect();
	  						});

							console.log("Now that DB is connected run pending queries ...");
							var pending = tableEnsure__pending;
							tableEnsure__pending = false;
							if (pending) {
								pending.forEach(function (call) {
									r.tableEnsure.apply(r, call);
								});
							}
						});
					}					
					connectToRethinkDB();
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
					console.log("Calling: " + req.headers["x-session-url"]);
	                return REQUEST({
	                    url: req.headers["x-session-url"],
	                    headers: {
	                        "Accept": "application/json"
	                    }
	                }, function(err, _res, body) {
	                    if (err) return callback(err);
	                    if (
	                    	_res.statusCode === 200 &&
	                    	body
	                    ) {
	                    	try {
		                    	body = JSON.parse(body);
		                    } catch(err) {
		                    	console.error("JSON parse error '" + err.message + "' while parsing:", body);
		                    	body = null;
		                    }
		                    if (body) {
		                    	body["$status"] === 200

	                    		delete body.$status;
								console.log("Got valid session info");
								if (req.session) {
		                    		req.session.authorized = body;
		                    	} else {
		                    		console.log("Warning: Did not cache session as our sessions are not enabled. To enable set the 'memcachedHost' config property.");
		                    	}
		                    	if (!res.view) {
		                    		res.view = {};
		                    	}
		                    	res.view.authorized = body;
		                    } else {
								console.log("No valid session info");
		                    }
                    	} else {
							console.log("No valid session info");
                    	}
						return next();
	                });
				});
		        if (preAutoRoutesHandler) {
		        	preAutoRoutesHandler(app, pio._config.config["pio.service"], {
		        		API: {
		        			FS: FS,
		        			EXPRESS: EXPRESS,
							DEEPMERGE: DEEPMERGE,
							WAITFOR: WAITFOR,
							Q: Q,
							REQUEST: REQUEST,
							SEND: SEND
		        		},
	        			r: r,
	        			makePublicklyAccessible: function(url) {
							var parsedUrl = URL.parse(url);
							delete parsedUrl.search;
							parsedUrl.query = QUERYSTRING.parse(parsedUrl.query);
							var accessProof = CRYPTO.createHash("sha1");
							accessProof.update(["access-proof", authCode, pioConfig.config.pio.hostname, parsedUrl.pathname].join(":"));
							parsedUrl.query["ap"] = accessProof.digest("hex");
							url = URL.format(parsedUrl);
							return url;
	        			}
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

		    		if (DEBUG) {
		    			console.log("processRequest", "pathname", pathname);
		    		}

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
		            if (req.query[".requestScope"] && req.query[".returnTo"]) {

		            	if (DEBUG) {
							console.log("req.query", req.query);
							console.log("req.headers", req.headers);
							console.log("req.session", req.session);
						}

	                	if (
	                		req.session &&
	                		req.session.authorized &&
	                		req.session.authorized.github &&
	                		req.session.authorized.github.links &&
	                		typeof req.session.authorized.github.links.requestScope !== "undefined"
	                	) {
	                		// TODO: Callback should come from config.
							var url = req.session.authorized.github.links.requestScope
										.replace(/\{\{scope\}\}/, req.query[".requestScope"])
										.replace(/\{\{callback\}\}/, addParamatersToUrl(req.query[".returnTo"], {
											".reload-session-authorization": "true"
										}));
							console.log("Redirecting to url to request additional auth scope:", url);
							return res.redirect(url);
	                	} else {
	                		console.log("Warning: 'req.session.authorized.github.links.requestScope' not set otherwise requested scope '" + req.query[".requestScope"] + "' could be authorized.");
	                	}
	                }

		    		function formatPath(callback) {

		    			function isFile (path, callback) {
							return FS.exists(path, function(exists) {
				    			if (!exists) {
				    				return callback(null, false);
				    			}
				    			return FS.stat(path, function(err, stat) {
				    				if (err) return callback(err);
				    				if (!stat.isFile()) {
				    					return callback(null, false);
				    				}
				    				return callback(null, true);
				    			});
				    		});
		    			}

		    			function isDirectory (path, callback) {
							return FS.exists(path, function(exists) {
				    			if (!exists) {
				    				return callback(null, false);
				    			}
				    			return FS.stat(path, function(err, stat) {
				    				if (err) return callback(err);
				    				if (!stat.isDirectory()) {
				    					return callback(null, false);
				    				}
				    				return callback(null, true);
				    			});
				    		});
		    			}

		    			function checkExtensions(originalPath, callback) {
				    		return isFile(originalPath, function(err, exists) {
				    			if (err) return callback(err);
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
						    		return isFile(path, function(err, exists) {
						    			if (err) return callback(err);
						    			return callback(null, path, exists);
						    		});
				    			}
				    			return callback(null, originalPath, true);
				    		});
		    			}

			    		if (DEBUG) {
			    			console.log("req.headers", req.headers);
			    		}

				    	if (!req.headers['x-theme']) {
			    			return checkExtensions(PATH.join(packagePath, documentRootPath, pathname), callback);
				    	}

			    		// Don't allow slashes in themes.
			    		// TODO: Use abstracted sanitizer.
			    		if (/\//.test(req.headers['x-theme'])) {
				    		if (DEBUG) {
				    			console.log("404: Slash in theme");
				    		}
			    			res.writeHead(404);
			    			return res.end();
			    		}

			    		// TODO: Make themes path configurable.
			    		var path = PATH.join(packagePath, "themes", req.headers['x-theme']);
			    		return isDirectory(path, function(err, exists) {
			    			if (err) return callback(err);
			    			if (!exists) {
					    		if (DEBUG) {
					    			console.log("404: Theme base path does not exist at: " + path);
					    		}
				    			res.writeHead(404);
				    			return res.end();
			    			}
			    			return checkExtensions(PATH.join(path, pathname), callback);
			    		});
		    		}

			    	return formatPath(function(err, path, pathExists) {
			    		if (err) return next(err);

			    		if (DEBUG) {
				    		console.log("formatted path", path, pathExists);
				    	}

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
		                            compiled = DOT.template(templateSource, undefined, res.viewdef || null);
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
				    			if (DEBUG) {
					    			console.log("overlayPath", overlayPath, overlayExists);
					    		}
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
			    				if (DEBUG) {
					    			console.log("makeRequest(upstreamInfo)", upstreamInfo);
					    		}
			    				var headers = {};
			    				if (upstreamInfo.theme) {
									headers["x-theme"] = upstreamInfo.theme;
									headers["x-format"] = "tpl";
			    				}
			    				if (upstreamInfo.headers) {
			    					for (var name in upstreamInfo.headers) {
			    						headers[name] = upstreamInfo.headers[name].replace("$" + name, req.headers[name] || "");
			    					}
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
			    				if (DEBUG) {
			    					console.log("upstream url", url);
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
				    				if (DEBUG) {
				    					console.log("upstream response code", response.statusCode);
				    				}
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

    					function loadConfig(callback) {

    						function loadLocal(callback) {
				    			function loadPath(configPath, callback) {
						    		return FS.exists(configPath, function(configExists) {
	//					    			console.log("configPath", configPath, configExists);
						    			if (!configExists) {
						    				return callback(null, false);
						    			}
						    			return FS.readJson(configPath, function (err, config) {
			    							if (err) return callback(err);
			    							if (typeof config.extends === "string") {
			    								return loadPath(PATH.join(configPath, "..", config.extends + ".overlay.json"), function (err, extendsConfig) {
			    									if (err) return callback(err);
								    				return callback(null, DEEPMERGE(extendsConfig, config));
			    								});
			    							}
						    				return callback(null, config);
						    			});
						    		});
				    			}
				    			return loadPath(overlayPath.replace(/\.[^\.]+$/, ".json"), callback);
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

//console.log("config", config);
		    					if (
		    						config &&
		    						config.$page &&
		    						config.$page.upstream &&
		    						config.$page.upstream.pathname
		    					) {
		    						pathname = config.$page.upstream.pathname;
		    					}
//console.log("pathname", pathname);

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

//console.log("final config", config);

		    						return callback(null, config);
				    			});
		    				});
    					}

	    				function processOverlay(config, templateSource, callback) {

							if (DEBUG) {
								console.log("processOverlay()");
							}

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
		    						var err = new Error("No upstream file found at url '" + response._url + "' even though we have an overlay at '" + overlayPath + "'! Remove the overlay or make sure the file is served by upstream server.");
		    						err.code = 404;
		    						return callback(err);
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
									at.session = {
										authorized: req.session.authorized ? true : false,
										roles: "[]"
									};
									if (req.session.authorized) {
										at.session.roles = JSON.stringify(req.session.authorized.roles);
									}
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

	    				return loadConfig(function(err, config) {
	    					if (err) return next(err);

							if (DEBUG) {
								console.log("loaded config", config);
							}

							if (typeof config.extends === "string") {
								overlayPath = PATH.join(overlayPath, "..", config.extends + ".overlay.htm" + ((config.extends === "./index")?"l":""));
							}

		    				return loadOverlay(function(err, templateSource) {
		    					if (err) return next(err);

								if (DEBUG) {
									console.log("loaded overlay templateSource", templateSource);
								}

		    					function returnUpstreamResource() {
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
												console.error("PROXY HEAD ERROR while calling '" + url + "':", err, err.stack);
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
												console.error("PROXY ERROR while calling '" + url + "':", err, err.stack);
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
		    					}

		    					if (templateSource || config) {
				    				return processOverlay(config, templateSource, function(err, config) {
				    					if (err) {
				    						if (err.code === 404) {
				    							// We ignore the missing upstream overlay path.
						    					return returnUpstreamResource();
				    						}
				    						return next(err);
				    					}
				    					// Response sent. Nothing more to do.
				    					return;
									});
		    					}

		    					if (
		    						!pio._config.config["pio.service"].config ||
		    						!pio._config.config["pio.service"].config.www ||
		    						!pio._config.config["pio.service"].config.www.extends
		    					) {
		    						return next();
		    					}

		    					return returnUpstreamResource();
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

			    app.use(function (err, req, res, next) {
		            if (err) {
		                if (err.code === 403 && typeof err.requestScope !== "undefined") {
		                	if (
		                		req.session.authorized &&
		                		req.session.authorized.github &&
		                		req.session.authorized.github.links &&
		                		typeof req.session.authorized.github.links.requestScope !== "undefined"
		                	) {
		                		// TODO: Callback should come from config.
								var url = req.session.authorized.github.links.requestScope
											.replace(/\{\{scope\}\}/, err.requestScope)
											.replace(/\{\{callback\}\}/, addParamatersToUrl("http://io-pinf-server-ci." + pioConfig.config.pio.hostname + ":8013" + req.url, {
												".reload-session-authorization": "true"
											}));
								console.log("Redirecting to url to request additional auth scope:", url);
								return res.redirect(url);
		                	} else {
		                		console.log("Warning: 'req.session.authorized.github.links.requestScope' not set otherwise requested scope '" + err.requestScope + "' could be authorized.");
		                	}
		                }
		                return next(err);
		            }
		            return next();
			    });

				console.log("Try listening at: http://0.0.0.0:" + PORT);

				var server = app.listen(PORT);

				console.log("Listening at: http://0.0.0.0:" + PORT);

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

