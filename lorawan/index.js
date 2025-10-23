const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const axios = require('axios');

(async () => {
    try {
        const COMPORT = "COM4";
        const ports = await SerialPort.list();
        console.log('Available ports:', ports);

        const loraPort = ports.find(port => port.path === COMPORT);
        if (loraPort) {
            console.log('LoRa module found on:', loraPort.path);

            // Create serial connection
            const port = new SerialPort({
                path: COMPORT,
                baudRate: 115200
            });

            // Use ReadlineParser to handle complete lines
            const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

            console.log("Serial connection started on " + COMPORT);

            // Function to send command and wait for response
            const sendCommand = (command, timeout = 2000) => {
                return new Promise((resolve, reject) => {
                    console.log(` Sending: ${command.trim()}`);

                    const timeoutId = setTimeout(() => {
                        reject(new Error(`Command timeout: ${command}`));
                    }, timeout);

                    const responseHandler = (data) => {
                        console.log(` Response: ${data}`);
                        clearTimeout(timeoutId);
                        parser.removeListener('data', responseHandler);
                        resolve(data);
                    };

                    parser.on('data', responseHandler);
                    port.write(command);
                });
            };

            port.on('open', async () => {
                console.log('🔌 Port opened successfully');

                try {
                    // Initialize LoRa with proper sequence and delays
                    console.log('🚀 Initializing LoRa...');

                    await sendCommand("AT\r\n");
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await sendCommand("AT+BAND=865000000\r\n");
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await sendCommand("AT+BAND?\r\n");
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await sendCommand("AT+CRFOP?\r\n");
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await sendCommand("AT+NETWORKID=0\r\n");
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await sendCommand("AT+NETWORKID?\r\n");
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await sendCommand("AT+ADDRESS=100\r\n");
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await sendCommand("AT+ADDRESS?\r\n");
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await sendCommand("AT+PARAMETER=12,7,1,8\r\n");
                    await new Promise(resolve => setTimeout(resolve, 500));

                    await sendCommand("AT+PARAMETER?\r\n");
                    await new Promise(resolve => setTimeout(resolve, 500));

                    console.log(' LoRa initialization completed');

                } catch (initError) {
                    console.error(' LoRa initialization failed:', initError.message);
                }

                function sendATCommand(command) {
                    port.write(`${command}\r\n`, err => {
                        if (err) {
                            console.error('Error writing to serial port:', err.message);
                        } else {
                            console.log(`Sent: ${command}`);
                        }
                    });
                }

                //sendATCommand('AT+SEND=102,9,102:reset');
                
                setTimeout(function () {
                    sendATCommand('AT+SEND=102,9,101:reset');
                }, 10000);
                
                   sendATCommand('AT+SEND=102,9,102:reset');


            });

            // Handle incoming data
            parser.on('data', async (data) => {
                console.log(" Complete message received: ", data);

                // Skip initialization responses
                if (data.includes('OK') || data.includes('AT') || data.startsWith('+') || data.startsWith("ERR")) {
                    if (!data.startsWith('+RCV=')) {
                        return; // Skip non-data responses
                    }
                }

                if (data.startsWith('+RCV=')) {
                    try {
                        console.log(' Processing LoRa message:', data);

                        const parts = data.split(',');
                        const sourceAddress = parts[0].replace('+RCV=', '');
                        const messageLength = parts[1];
                        const substring = parts[2];


                        console.log(" Source address:", sourceAddress);
                        console.log(" Message length:", messageLength);
                        console.log(" Data:", substring);

                        // 116 to 245 

                        if (substring === 'TEST' || substring.includes('TEST')) {
                            const add = substring.split(':')[0];
                            console.log("🧪 Test message from address:", add);
                            // Send back a test response
                            const cmd = `AT+SEND=` + sourceAddress + `,` + 6 + add.length + `,` + add + ":Hello" + `\r\n`;
                            port.write(cmd, (err) => {
                                if (err) {
                                    console.error(' Serial write error:', err.message);
                                }
                            });
                            console.log('🧪 Test message received, ignoring');
                            return;
                        }

                        const parsedData = { data: { hostName: substring.split(":")[0] == 102 ? 'FX96007C3C8A' : "FX96007C3C8E", idHex: substring.split(":")[1].split("_")[0], antenna: substring.split(":")[1].split("_")[1] } };
                        const arraydata = [parsedData]; // Fix: proper array creation

                        // People counter logic
                        if (substring.includes("::")) {

                            const parts = substring.split("::");
                            console.log("🚶 People counter data parts:", parts);
                            const inc = parts[0].split(":")[2];
                            const out = parts[1].split(":")[1];
                            console.log(`🚶 People Counter - In: ${inc}, Out: ${out}`);

                            const payload = {
                                peopleCounterHost: substring.split(":")[0],
                                dateTime: new Date().toISOString(),
                                counts: { In: inc, Out: out },
                                brand: "6846a87739bf7e0af0a783be",
                                venue: "6846a878bb8b6fd560732c8a",
                                _id: sourceAddress == 102 ? "68e60fb458c3732e402ce1cd" : "68e6100258c3732e402ce1ce"
                            };

                            try {
                                const res = await axios.post(
                                    "http://localhost:4000/v1/space/peopleCounter/updatePeopleCounts",
                                    payload, // Don't stringify, axios does it automatically
                                    {
                                        headers: { 'Content-Type': 'application/json' },
                                        timeout: 5000
                                    }
                                );
                                console.log(" People counter response:", res.data);
                            } catch (e) {
                                console.log(" People counter error:", e.message);
                            }
                            return;
                        }

                        // RFID gate logic
                        try {
                            console.log("🌐 Sending data to server:", arraydata);
                            const res = await axios.post(
                                "http://localhost:4000/v1/space/gate/checkin",
                                arraydata, // Don't stringify arrays
                                {
                                    headers: { 'Content-Type': 'application/json' },
                                    timeout: 5000
                                }
                            );

                            console.log(" Server response:", res.data);

                            function getMinuteDifference(date1, date2) {
                                // Convert the dates to milliseconds.
                                let date1InMilliseconds = date1.getTime();
                                let date2InMilliseconds = date2.getTime();

                                // Calculate the difference in milliseconds.
                                let differenceInMilliseconds = date1InMilliseconds - date2InMilliseconds;

                                // Divide the difference in milliseconds by the number of milliseconds in a Minute.
                                let differenceInMinute = differenceInMilliseconds / (1000 * 60);

                                // Return the difference in Minute.
                                return Math.round(differenceInMinute);
                            }
                            async function getPendingMinute(item) {
                                let date1 = new Date();
                                let date2 = new Date(item);
                                return await getMinuteDifference(date1, date2);
                            }



                            // Time check logic
                            if (res.data && res.data?.lastReadAt) {


                                let passCheckOutValidity = await getPendingMinute(res.data?.lastReadAt);
                                console.log(" Minutes since last read:", passCheckOutValidity);
                                if (passCheckOutValidity > 0 && passCheckOutValidity < 2) {
                                    console.log(" Recent read, updating lastReadAt only");

                                    try {
                                        const updatePayload = {
                                            _id: res.data._id,
                                            lastReadAt: new Date().toISOString()
                                        };

                                        await axios.put(
                                            "http://localhost:4000/v1/visitor/checkins",
                                            updatePayload,
                                            {
                                                headers: { 'Content-Type': 'application/json' },
                                                timeout: 5000
                                            }
                                        );

                                        console.log(" LastReadAt updated successfully");
                                        return;
                                    } catch (updateError) {
                                        console.log(" Update error:", updateError.message);
                                        return;
                                    }
                                } else {
                                    console.log(" More than 2 hours since last read, proceeding with authorization");
                                }
                            }

                            // Send authorization response
                            if (res.data && typeof res.data.isAuthorized === 'boolean') {
                                const responseData = res.data.isAuthorized ? 'green' : 'red';
                                const add = substring.split(':')[0];
                                // const command = `AT+SEND=${sourceAddress},${responseData.length + extender.length + 1},${extender}:${responseData}\r\n`;
                                const command = `AT+SEND=${sourceAddress},${responseData.length + 1 + add.length},${add}:${responseData}\r\n`;
                                console.log("dekhoooooooo", command);

                                console.log(` Sending: ${command.trim()}`);

                                port.write(command, (err) => {
                                    if (err) {
                                        console.error(' Serial write error:', err.message);
                                    } else {
                                        console.log(` Response sent to ${sourceAddress}: ${responseData}`);
                                    }
                                });
                            } else  {
                                console.log(" No authorization status found");
                                const add = substring.split(':')[0];
                                //  const command = `AT+SEND=${sourceAddress},${4 + extender.length},${extender}:red\r\n`;
                                const command = `AT+SEND=${sourceAddress},${4 + add.length},${add}:red\r\n`;
                                console.log("dekhoooooooo", command);
                                // if(substring.split(":")[1].split("_")[1] == "1") {

                                    port.write(command, (err) => {
                                        if (!err) console.log(` Default red sent to ${sourceAddress}`);
                                    });
                                // }
                            }

                        } catch (apiError) {
                            console.error(" API Error:", apiError.message);
                            // const command = `AT+SEND=${sourceAddress},${4 + extender.length},${extender}:red\r\n`;
                            const add = substring.split(':')[0];
                            const command = `AT+SEND=${sourceAddress},${4 + add.length},${add}:red\r\n`;
                            console.log("dekhoooooooo", command);
                            port.write(command, (err) => {
                                if (!err) console.log(` Error red sent to ${sourceAddress}`);
                            });
                        }

                    } catch (parseError) {
                        console.log(" Parse error:", parseError.message);
                    }
                }
            });

            port.on('error', (err) => {
                console.error(' Serial port error:', err.message);
            });

            // Graceful shutdown
            process.on('SIGINT', () => {
                console.log('\n Shutting down gracefully...');
                port.close(() => {
                    console.log(' Serial port closed');
                    process.exit(0);
                });
            });

        } else {
            console.log(' LoRa module not found on ' + COMPORT);
        }

    } catch (error) {
        console.error(' Error:', error.message);
    }
})();


