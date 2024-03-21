FROM node:lts
# create app directory
RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app
# set working directory
WORKDIR /home/node/app
# copy package.json and package-lock.json
COPY package*.json ./
# swtich to node user
USER node
# install dependencies
RUN npm install
# copy app source]
COPY --chown=node:node . .
# wirte .env file
RUN echo printenv > .env
# run start-cli
CMD ["npm", "run", "start-cli"]
