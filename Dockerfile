FROM public.ecr.aws/lambda/nodejs:22 AS builder
WORKDIR /usr/app
# Compile TS into JS
COPY package.json index.ts yarn.lock tsconfig.json ./
ADD src/ src/
ADD utils/ utils/

# Install node modules
RUN npm install -g yarn
RUN yarn
RUN yarn build

FROM public.ecr.aws/lambda/nodejs:22
WORKDIR /
# Install chrome dependencies (AL2023 uses dnf instead of yum)
RUN dnf install -y unzip atk at-spi2-atk gtk3 cups-libs pango libdrm \
    libXcomposite libXcursor libXdamage libXext libXtst libXt \
    libXrandr libXScrnSaver alsa-lib nss mesa-libgbm libXi \
    dbus-libs xdg-utils jq && dnf clean all
# Install chromium, chrome-driver. Installs to /opt/
COPY scripts/install-chrome.sh /tmp/
RUN /usr/bin/bash /tmp/install-chrome.sh

# Copy over built code and node_modules from builder
COPY --from=builder /usr/app/dist/ /var/task/dist/
COPY --from=builder /usr/app/node_modules/ /var/task/node_modules/
CMD ["dist/index.handler"]