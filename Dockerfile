FROM public.ecr.aws/lambda/nodejs:18 as builder
WORKDIR /usr/app
# Compile TS into JS
COPY package.json index.ts yarn.lock tsconfig.json ./
ADD src/ src/
ADD utils/ utils/

# Install node modules
RUN npm install -g yarn
RUN yarn
RUN yarn build

FROM public.ecr.aws/lambda/nodejs:18
WORKDIR /
# Install chrome dependencies
RUN yum install unzip atk at-spi2-atk gtk3 cups-libs pango libdrm \ 
    libXcomposite libXcursor libXdamage libXext libXtst libXt \
    libXrandr libXScrnSaver alsa-lib -y
# Install chromium, chrome-driver. Installs to /opt/
COPY scripts/install-chrome.sh /tmp/
RUN /usr/bin/bash /tmp/install-chrome.sh

# Copy over main application code from builder
COPY --from=builder /usr/app/* /var/task/
CMD ["dist/index.handler"]