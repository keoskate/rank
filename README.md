# Rank

## Running on localhost

* 1. Start Server: `npm run server-dev`
* 2. Start React Client: `npm run react-dev`
* 3. Go to URL: `http://localhost:8080/`

## Setup Instructions:

### Setting up the basic environment

1. Install Node Package Manager: `sudo npm install -g`
2. Start new web app: `npm init`

3. Setup package.json with all dependencies 

4. Install nodemon: `sudo npm install -g nodemon`

#### Install Express.js for our server  
* `npm install express --save`
* `npm install body-parser --save`


### Installing the React framework

* `npm install react --save`
* `npm install react-dom --save`

#### React Router is a very useful navigational tool for React applications:
* `npm install react-router-dom --save`
* `npm install react-router --save`


### Creating a webpack
Webpack is a tool that combines our separate code files into one called a “bundle” file which the browser can then interpret.

* `npm install webpack --save`

Add the following webpack and node scripts to your package.json file:

```
"scripts": {
  "dev": "webpack -d --watch",
  "start": "node ./server/index.js",
  "build": "webpack -p",
  "react-dev": "webpack -d --watch",
  "server-dev": "nodemon server/index.js"
},
```

In your index.html folder, add the following script just before `</body>`:

`<script type="text/javascript" src="bundle.js"></script>`

#### Install babel dependencies

```
npm install babel-core --save
npm install babel-loader --save
npm install babel-preset-es2015 --save
npm install babel-preset-react --save
```

