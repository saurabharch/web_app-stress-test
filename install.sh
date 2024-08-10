sudo chmod 755 ./stress.js
sudo chmod 755 ./nvm.sh
sudo curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash
sudo apt-get install curl -y
sudo apt-get update -y
# sudo apt install nodejs
# sudo apt install npm
sudo apt-get install python-software-properties
sudo sh ./nvm.sh
sudo curl -sL https://deb.nodesource.com/setup_current.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo node -v
sudo npm -v
sudo apt-get install -y wget
sudo apt-get update && sudo apt-get -y upgrade
sudo apt install python3-pip && sudo apt install python-pip
sudo pip3 --version
sudo /usr/bin/python3 -m pip install --upgrade pip
sudo npm i -g autocannon
npm install -g thor
sudo npm install
# sudo npm run start
sudo npm i -g pm2 && sudo pm2 start --name stress-bot stress.js --watch && sudo pm2 startup && sudo pm2 save