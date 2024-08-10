# web_app-stress-test

```bash 
sudo apt-get install -y git && git clone https://github.com/saurabharch/web_app-stress-test && sudo  unzip wen_app-stress-test . && cd web_app-stress-test && sudo bash ./nvm.sh &&sudo bash ./install.sh && sudo apt install npm && node -v && npm -v && npm i -g autocannon && npm i && sudo npm i -g pm2 && sudo pm2 start --name stress-bot stress.js -i 1 --watch && sudo pm2 startup && sudo pm2 save && sudo pm2 update

```