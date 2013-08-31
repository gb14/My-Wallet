//------
//Should find somewhere else for these
//user precision (e.g. BTC or mBTC) to satoshi big int
function precisionToSatoshiBN(x) {
    return Bitcoin.Util.parseValue(x).divide(BigInteger.valueOf(Math.pow(10, sShift(symbol_btc)).toString()));
}

//user precision (e.g. 0.02 BTC or 0.02 mBTC) to BTC decimal
function precisionToBTC(x) {
    return Bitcoin.Util.formatValue(precisionToSatoshiBN(x));
}

//BTC decimal to user precision (e.g. BdeleteAddressTC or mBTC)
function precisionFromBTC(x) {
    return Bitcoin.Util.formatValue(Bitcoin.Util.parseValue(x).multiply(BigInteger.valueOf(Math.pow(10, sShift(symbol_btc)))));
}

//user precision to display string
function formatPrecision(x) {
    return formatBTC(precisionToSatoshiBN(x).toString());
}
//-----

var MyWallet = new function() {
    var MyWallet = this;

    this.skip_init = false; //Set on sign up page
    var demo_guid = 'abcaa314-6f67-6705-b384-5d47fbe9d7cc';
    var encrypted_wallet_data; //Encrypted wallet data (Base64, AES 256)
    var guid; //Wallet identifier
    var cVisible; //currently visible view
    var password; //Password
    var dpassword; //double encryption Password
    var dpasswordhash; //double encryption Password
    var sharedKey; //Shared key used to prove that the wallet has succesfully been decrypted, meaning you can't overwrite a wallet backup even if you have the guid
    var final_balance = 0; //Final Satoshi wallet balance
    var total_sent = 0; //Total Satoshi sent
    var total_received = 0; //Total Satoshi received
    var n_tx = 0; //Number of transactions
    var n_tx_filtered = 0; //Number of transactions after filtering
    var latest_block; //Chain head block
    var address_book = {}; //Holds the address book addr = label
    var transactions = []; //List of all transactions (initially populated from /multiaddr updated through websockets)
    var double_encryption = false; //If wallet has a second password
    var tx_page = 0; //Multi-address page
    var tx_filter = 0; //Transaction filter (e.g. Sent Received etc)
    var maxAddr = 1000; //Maximum number of addresses
    var addresses = {}; //{addr : address, priv : private key, tag : tag (mark as archived), label : label, balance : balance}
    var payload_checksum; //SHA256 hash of the current wallet.aes.json
    var archTimer; //Delayed Backup wallet timer
    var mixer_fee = 0.5; //Default mixer fee 1.5%
    var default_pbkdf2_iterations = 10; //Not ideal, but limitations of using javascript
    var tx_notes = {}; //A map of transaction notes, hash -> note
    var real_auth_type = 0;
    var auth_type;
    var logout_timeout;
    var event_listeners = []; //Emits Did decrypt wallet event (used on claim page)
    var last_input_main_password;
    var main_password_timeout = 60000;
    var isInitialized = false;
    var extra_seed; //Help for browsers that don't support window.crypto
    var show_unsynced = false;
    var language = 'en';

    var wallet_options = {
        pbkdf2_iterations : 10, //Number of pbkdf2 iterations to default to for second password and dpasswordhash
        fee_policy : 0,  //Default Fee policy (-1 Tight, 0 Normal, 1 High)
        html5_notifications : false, //HTML 5 Desktop notifications
        logout_time : 600000, //Default 10 minutes
        tx_display : 0, //Compact or detailed transactions
        always_keep_local_backup : false //Whether to always keep a backup in localStorage regardless of two factor authentication
    };

    this.setEncryptedWalletData = function(data) {
        if (!data || data.length == 0) {
            encrypted_wallet_data = null;
            payload_checksum = null;
            return;
        }

        encrypted_wallet_data = data;

        //Generate a new Checksum
        payload_checksum = generatePayloadChecksum();

        try {
            //Save Payload when two factor authentication is disabled
            if (real_auth_type == 0 || wallet_options.always_keep_local_backup)
                MyStore.put('payload', encrypted_wallet_data);

        } catch (e) {
            console.log(e);
        }
    }

    this.setRealAuthType = function(val) {
        real_auth_type = val;
    }

    this.getLanguage = function() {
        return language;
    }

    this.addEventListener = function(func) {
        event_listeners.push(func);
    }

    this.getLogoutTime = function() {
        return wallet_options.logout_time;
    }

    this.getDefaultPbkdf2Iterations = function() {
        return default_pbkdf2_iterations;
    }

    this.getPbkdf2Iterations = function() {
        return wallet_options.pbkdf2_iterations;
    }

    this.setLogoutTime = function(logout_time) {
        wallet_options.logout_time = logout_time;

        clearInterval(logout_timeout);

        logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());
    }

    this.getDoubleEncryption = function() {
        return double_encryption;
    }

    this.getEncryptedWalletData = function() {
        return encrypted_wallet_data;
    }

    this.getFeePolicy = function() {
        return wallet_options.fee_policy;
    }

    this.setFeePolicy = function(policy) {
        wallet_options.fee_policy = parseInt(policy);
    }

    this.setAlwaysKeepLocalBackup = function(val) {
        wallet_options.always_keep_local_backup = val;
    }

    this.getAlwaysKeepLocalBackup = function() {
        return wallet_options.always_keep_local_backup;
    }

    this.getGuid = function() {
        return guid;
    }

    this.getHTML5Notifications = function() {
        return wallet_options.html5_notifications;
    }

    this.setHTML5Notifications = function(val) {
        wallet_options.html5_notifications = val;
    }

    this.getTransactions = function() {
        return transactions;
    }

    this.addressExists = function(address) {
        return addresses[address] != null;
    }

    this.getAddressTag = function(address) {
        return addresses[address].tag;
    }

    this.setAddressTag = function(address, tag) {
        addresses[address].tag = tag;
    }

    this.getAddressBook = function() {
        return address_book;
    }

    this.getAddressLabel = function(address) {
        return addresses[address].label;
    }

    this.setAddressLabel = function(address, label) {
        addresses[address].label = label;
    }

    this.setAddressBalance = function(address, balance) {
        addresses[address].balance = balance;
    }

    this.getAddressBookLabel = function(address) {
        return address_book[address];
    }

    this.isWatchOnly = function(address) {
        return !addresses[address] || addresses[address].priv == null;
    }

    this.getAddressBalance = function(address) {
        return addresses[address].balance;
    }

    this.getMixerFee = function() {
        return mixer_fee;
    }

    this.deleteAddress = function(addr) {
        delete addresses[addr];
    }

    this.addAddressBookEntry = function(addr, label) {
        address_book[addr] = label;
    }

    //TODO Depreciate this. Need to restructure signer.js
    this.getPrivateKey = function(address) {
        return addresses[address].priv;
    }

    this.setLabel = function(address, label) {

        addresses[address].label = label;

        backupWalletDelayed();

        buildVisibleView();
    }

    this.securePost = function(url, data, success, error) {
        var clone = jQuery.extend({}, data);

        if (sharedKey == null || sharedKey.length == 0 || sharedKey.length != 36) {
            throw 'Shared key is invalid';
        }

        clone.sharedKey = sharedKey;
        clone.guid = guid;
        clone.format =  data.format ? data.format : 'plain'

        $.ajax({
            dataType: data.format ? data.format : 'text',
            type: "POST",
            url: root + url,
            data : clone,
            success: function(data) {
                success(data)
            },
            error : function(e) {
                error(e)
            }
        });
    }

    this.isCorrectMainPassword = function(_password) {
        return password == _password;
    }

    function hashPassword(password, iterations) {
        //N rounds of SHA 256
        var round_data = Crypto.SHA256(password, {asBytes: true});
        for (var i = 1; i < iterations; ++i) {
            round_data = Crypto.SHA256(round_data, {asBytes: true});
        }
        return Crypto.util.bytesToHex(round_data);
    }

    this.setPbkdf2Iterations = function(pbkdf2_iterations, success) {
        var panic = function(e) {
            console.log('Panic ' + e);

            //If we caught an exception here the wallet could be in a inconsistent state
            //We probably haven't synced it, so no harm done
            //But for now panic!
            //  window.location.reload();
        };

        MyWallet.getSecondPassword(function() {
            try {
                //If double encryption is enabled we need to rencrypt all keys
                if (double_encryption) {
                    //Ask the use again before we backup
                    try {
                        //Rencrypt all keys
                        for (var key in addresses) {
                            var addr = addresses[key];

                            if (addr.priv) {
                                addr.priv = MyWallet.encrypt(MyWallet.decryptPK(addr.priv), sharedKey + dpassword, pbkdf2_iterations);

                                if (!addr.priv) throw 'addr.priv is null';
                            }
                        }

                        wallet_options.pbkdf2_iterations = pbkdf2_iterations;

                        //Generate a new password hash
                        dpasswordhash = hashPassword(sharedKey + dpassword, wallet_options.pbkdf2_iterations);

                        //Now backup and save
                        MyWallet.checkAllKeys();

                        MyWallet.backupWallet('update', function() {
                            success();
                        }, function() {
                            panic(e);
                        });
                    } catch(e) {
                        panic(e);
                    }
                } else {
                    MyWallet.backupWallet('update', function() {
                        success();
                    }, function() {
                        panic(e);
                    });
                }
            } catch (e) {
                panic(e);
            }
        }, function (e) {
            panic(e);
        });
    }

    this.setDoubleEncryption = function(value, tpassword, success) {
        var panic = function(e) {
            console.log('Panic ' + e);

            //If we caught an exception here the wallet could be in a inconsistent state
            //We probably haven't synced it, so no harm done
            //But for now panic!
            window.location.reload();
        };

        try {
            if (double_encryption == value)
                return;

            if (value) {
                //Ask the use again before we backup
                MyWallet.getSecondPassword(function() {
                    try {
                        double_encryption = true;
                        dpassword = tpassword;

                        for (var key in addresses) {
                            var addr = addresses[key];

                            if (addr.priv) {
                                addr.priv = encodePK(B58.decode(addr.priv));

                                if (!addr.priv) throw 'addr.priv is null';
                            }
                        }

                        dpasswordhash = hashPassword(sharedKey + dpassword, wallet_options.pbkdf2_iterations);

                        //Clear the password to force the user to login again
                        //Incase they have forgotten their password already
                        dpassword = null;

                        MyWallet.getSecondPassword(function() {
                            try {
                                MyWallet.checkAllKeys();

                                MyWallet.backupWallet('update', function() {
                                    success();
                                }, function() {
                                    panic(e);
                                });
                            } catch(e) {
                                panic(e);
                            }
                        }, function(e) {
                            panic(e);
                        });
                    } catch(e) {
                        panic(e);
                    }
                }, function (e) {
                    panic(e);
                });
            } else {
                MyWallet.getSecondPassword(function() {
                    try {
                        for (var key in addresses) {

                            var addr = addresses[key];

                            if (addr.priv) {
                                addr.priv = MyWallet.decryptPK(addr.priv);

                                if (!addr.priv) throw 'addr.priv is null';
                            }
                        }

                        double_encryption = false;

                        dpassword = null;

                        MyWallet.checkAllKeys();

                        MyWallet.backupWallet('update', function() {
                            success();
                        }, function() {
                            panic(e);
                        });
                    } catch (e) {
                        panic(e);
                    }
                }, function(e) {
                    panic(e);
                });
            }
        } catch (e) {
            panic(e);
        }
    }

    this.unArchiveAddr = function(addr) {
        var addr = addresses[addr];
        if (addr.tag == 2) {
            addr.tag = null;

            buildVisibleView();

            backupWalletDelayed('update', function() {
                MyWallet.get_history();
            });
        } else {
            MyWallet.makeNotice('error', 'add-error', 'Cannot Unarchive This Address');
        }
    }

    this.archiveAddr = function(addr) {
        if (MyWallet.getActiveAddresses().length <= 1) {
            MyWallet.makeNotice('error', 'add-error', 'You must leave at least one active address');
            return;
        }

        var addr = addresses[addr];
        if (addr.tag == null || addr.tag == 0) {
            addr.tag = 2;

            buildVisibleView();

            backupWalletDelayed('update', function() {
                MyWallet.get_history();
            });

        } else {
            MyWallet.makeNotice('error', 'add-error', 'Cannot Archive This Address');
        }
    }
    this.addWatchOnlyAddress = function(address) {
        return internalAddKey(address);
    }


    //opts = {compressed, app_name, app_version, created_time}
    this.addPrivateKey = function(key, opts) {
        if (walletIsFull())
            return false;


        if (key == null) {
            throw 'Cannot add null key.';
        }

        if (opts == null)
            opts = {};

        var addr = opts.compressed ? key.getBitcoinAddressCompressed().toString() : key.getBitcoinAddress().toString();

        var encoded = encodePK(key.priv);

        if (encoded == null)
            throw 'Error Encoding key';

        var decoded_key = new Bitcoin.ECKey(MyWallet.decodePK(encoded));

        if (addr != decoded_key.getBitcoinAddress().toString() && addr != decoded_key.getBitcoinAddressCompressed().toString()) {
            throw 'Decoded Key address does not match generated address';
        }

        if (internalAddKey(addr, encoded)) {
            addresses[addr].tag = 1; //Mark as unsynced
            addresses[addr].created_time = opts.created_time ? opts.created_time : 0; //Stamp With Creation time
            addresses[addr].created_device_name = opts.app_name ? opts.app_name : APP_NAME; //Created Device
            addresses[addr].created_device_version = opts.app_version ? opts.app_version : APP_VERSION; //Created App Version

            if (addresses[addr].priv != encoded)
                throw 'Address priv does not match encoded';

            //Subscribe to transaction updates through websockets
            try {
                ws.send('{"op":"addr_sub", "addr":"'+addr+'"}');
            } catch (e) { }
        } else {
            throw 'Unable to add generated bitcoin address.';
        }

        return addr;
    }

    this._seed = function(_password) {
        rng_seed_time();

        //rng pool is seeded on key press and mouse movements
        //Add extra entropy from the user's password
        if (password || _password) {
            var word_array = Crypto.util.bytesToWords(Crypto.SHA256(password ? password : _password, {asBytes: true}));

            for (var i in word_array) {
                rng_seed_int(word_array[i]);
            }
        }

        if (!extra_seed) {
            extra_seed = $('body').data('extra-seed');
        }

        //Extra entropy from a random number provided by server
        if (extra_seed) {
            var word_array = Crypto.util.bytesToWords(Crypto.util.hexToBytes(extra_seed));

            for (var i in word_array) {
                rng_seed_int(word_array[i]);
            }
        }
    }

    this.generateNewKey = function(_password) {
        MyWallet._seed(_password);

        var key = new Bitcoin.ECKey(false);

        if (MyWallet.addPrivateKey(key)) {
            return key;
        }
    }

    this.setLoadingText = function(txt) {
        $('.loading-text').text(txt);
    }

    function hidePopovers() {
        try {
            $('.popover').remove();
        } catch (e) {}
    }

    $(window).resize(function() {
        $('.modal:visible').center();

        hidePopovers();
    });

    function bindTx(tx_tr, tx) {
        tx_tr.click(function(){
            openTransactionSummaryModal(tx.txIndex, tx.result);
        });

        tx_tr.find('.show-note').mouseover(function() {
            var note = tx.note ? tx.note : tx_notes[tx.hash];
            showNotePopover(this, note, tx.hash);
        });

        tx_tr.find('.add-note').mouseover(function() {
            addNotePopover(this, tx.hash);
        });

        return tx_tr;
    }

    function calcTxResult(tx, is_new) {
        /* Calculate the result */
        var result = 0;
        for (var i = 0; i < tx.inputs.length; ++i) {
            var output = tx.inputs[i].prev_out;

            if (!output || !output.addr)
                continue;

            //If it is our address then subtract the value
            var addr = addresses[output.addr];
            if (addr) {
                var value = parseInt(output.value);

                result -= value;

                if (is_new) {
                    total_sent += value;
                    addr.balance -= value;
                }
            }
        }

        for (var ii = 0; ii < tx.out.length; ++ii) {
            var output = tx.out[ii];

            if (!output || !output.addr)
                continue;

            var addr = addresses[output.addr];
            if (addr) {
                var value = parseInt(output.value);

                result += value;

                if (is_new) {
                    total_received += value;
                    addr.balance += value;
                }
            }
        }
        return result;
    }

    function generatePayloadChecksum() {
        return Crypto.util.bytesToHex(Crypto.SHA256(encrypted_wallet_data, {asBytes: true}));
    }

    function wsSuccess(ws) {
        ws.onmessage = function(e) {

            try {
                var obj = $.parseJSON(e.data);

                if (obj.op == 'on_change') {
                    var old_checksum = generatePayloadChecksum();
                    var new_checksum = obj.checksum;

                    console.log('On change old ' + old_checksum + ' ==  new '+ new_checksum);

                    if (old_checksum != new_checksum) {
                        //Fetch the updated wallet from the server
                        setTimeout(getWallet, 150);
                    }

                } else if (obj.op == 'utx') {

                    var tx = TransactionFromJSON(obj.x);

                    //Check if this is a duplicate
                    //Maybe should have a map_prev to check for possible double spends
                    for (var key in transactions) {
                        if (transactions[key].txIndex == tx.txIndex)
                            return;
                    }

                    var result = calcTxResult(tx, true);

                    if (MyWallet.getHTML5Notifications()) {
                        //Send HTML 5 Notification
                        MyWallet.showNotification({
                            title : result > 0 ? 'Payment Received' : 'Payment Sent',
                            body : 'Transaction Value ' + formatBTC(result),
                            iconUrl : resource + 'cube48.png'
                        });
                    }

                    tx.result = result;

                    final_balance += result;

                    n_tx++;

                    tx.setConfirmations(0);

                    playSound('beep');

                    if (tx_filter == 0 && tx_page == 0) {
                        transactions.unshift(tx);

                        var did_pop = false;
                        if (transactions.length > 50) {
                            transactions.pop();
                            did_pop = true;
                        }
                    }

                    var id = buildVisibleViewPre();
                    if ("my-transactions" == id) {
                        if (tx_filter == 0 && tx_page == 0) {
                            $('#no-transactions').hide();

                            if (wallet_options.tx_display == 0) {
                                var txcontainer = $('#transactions-compact').show();

                                bindTx($(getCompactHTML(tx, addresses, address_book)), tx).prependTo(txcontainer.find('tbody')).find('div').hide().slideDown('slow');

                                if (did_pop) {
                                    txcontainer.find('tbody tr:last-child').remove();
                                }

                            } else {
                                var txcontainer = $('#transactions-detailed').show();

                                txcontainer.prepend(tx.getHTML(addresses, address_book));

                                if (did_pop) {
                                    txcontainer.find('div:last-child').remove();
                                }

                                setupSymbolToggle();
                            }
                        }
                    } else {
                        buildVisibleView();
                    }

                }  else if (obj.op == 'block') {
                    //Check any transactions included in this block, if the match one our ours then set the block index
                    for (var i = 0; i < obj.x.txIndexes.length; ++i) {
                        for (var ii = 0; ii < transactions.length; ++ii) {
                            if (transactions[ii].txIndex == obj.x.txIndexes[i]) {
                                if (transactions[ii].blockHeight == null || transactions[ii].blockHeight == 0) {
                                    transactions[ii].blockHeight = obj.x.height;
                                    break;
                                }
                            }
                        }
                    }

                    setLatestBlock(BlockFromJSON(obj.x));

                    //Need to update latest block
                    buildTransactionsView();
                }

            } catch(e) {
                console.log(e);

                console.log(e.data);
            }
        };

        ws.onopen = function() {
            setLogoutImageStatus('ok');

            var msg = '{"op":"blocks_sub"}';

            if (guid != null)
                msg += '{"op":"wallet_sub","guid":"'+guid+'"}';

            try {
                var addrs = MyWallet.getActiveAddresses();
                for (var key in addrs) {
                    msg += '{"op":"addr_sub", "addr":"'+ addrs[key] +'"}'; //Subscribe to transactions updates through websockets
                }
            } catch (e) {
                alert(e);
            }

            ws.send(msg);
        };

        ws.onclose = function() {
            setLogoutImageStatus('error');
        };
    }

    var logout_status = 'ok';
    function setLogoutImageStatus(_status) {
        var logout_btn = $('#logout');

        if (_status == 'loading_start') {
            logout_btn.attr('src', resource + 'logout-orange.png');
            return;
        } else if (_status != 'loading_stop') {
            logout_status = _status;
        }

        if (logout_status == 'ok')
            logout_btn.attr('src', resource + 'logout.png');
        else if (logout_status == 'error')
            logout_btn.attr('src', resource + 'logout-red.png');
    }

    this.showNotification = function(options) {
        try {
            if (window.webkitNotifications && navigator.userAgent.indexOf("Chrome") > -1) {
                if (webkitNotifications.checkPermission() == 0) {
                    webkitNotifications.createNotification(options.iconUrl, options.title, options.body).show();
                }
            } else if (window.Notification) {
                if (Notification.permissionLevel() == 'granted') {
                    new Notification(options.title, options).show();
                }
            }
        } catch (e) {}
    };

    this.makeNotice = function(type, id, msg, timeout) {

        if (msg == null || msg.length == 0)
            return;

        console.log(msg);

        if (timeout == null)
            timeout = 5000;

        var el = $('<div class="alert alert-block alert-'+type+'"></div>');

        el.text(''+msg);

        if ($('#'+id).length > 0) {
            el.attr('id', id);
            return;
        }

        $("#notices").append(el).hide().fadeIn(200);

        if (timeout > 0) {
            (function() {
                var tel = el;

                setTimeout(function() {
                    tel.fadeOut(250, function() {
                        $(this).remove();
                    });
                }, timeout);
            })();
        }
    }

    this.pkBytesToSipa = function(bytes, addr) {
        var eckey = new Bitcoin.ECKey(bytes);

        while (bytes.length < 32) bytes.unshift(0);

        bytes.unshift(0x80); // prepend 0x80 byte

        if (eckey.getBitcoinAddress().toString() == addr) {
        } else if (eckey.getBitcoinAddressCompressed().toString() == addr) {
            bytes.push(0x01);    // append 0x01 byte for compressed format
        } else {
            throw 'Private Key does not match bitcoin address' + addr;
        }

        var checksum = Crypto.SHA256(Crypto.SHA256(bytes, { asBytes: true }), { asBytes: true });

        bytes = bytes.concat(checksum.slice(0, 4));

        var privWif = B58.encode(bytes);

        return privWif;
    }

    function noConvert(x) { return x; }
    function base58ToBase58(x) { return MyWallet.decryptPK(x); }
    function base58ToBase64(x) { var bytes = MyWallet.decodePK(x); return Crypto.util.bytesToBase64(bytes); }
    function base58ToHex(x) { var bytes = MyWallet.decodePK(x); return Crypto.util.bytesToHex(bytes); }
    this.base58ToSipa = function(x, addr) {
        return MyWallet.pkBytesToSipa(MyWallet.decodePK(x), addr);
    }

    this.makeWalletJSON = function(format) {
        return MyWallet.makeCustomWalletJSON(format, guid, sharedKey);
    }

    this.makeCustomWalletJSON = function(format, guid, sharedKey) {

        var encode_func = noConvert;

        if (format == 'base64')
            encode_func = base58ToBase64;
        else if (format == 'hex')
            encode_func = base58ToHex;
        else if (format == 'sipa')
            encode_func = MyWallet.base58ToSipa;
        else if (format == 'base58')
            encode_func = base58ToBase58;

        var out = '{\n	"guid" : "'+guid+'",\n	"sharedKey" : "'+sharedKey+'",\n';

        if (double_encryption && dpasswordhash != null && encode_func == noConvert) {
            out += '	"double_encryption" : '+double_encryption+',\n	"dpasswordhash" : "'+dpasswordhash+'",\n';
        }

        if (wallet_options) {
            out += '	"options" : ' + JSON.stringify(wallet_options)+',\n';
        }

        out += '	"keys" : [\n';

        for (var key in addresses) {
            var addr = $.extend({}, addresses[key]);

            if (addr.priv != null) {
                addr.priv = encode_func(addr.priv, addr.addr);
            }

            //Delete null values
            for (var i in addr) {
                if (addr[i] === null || addr[i] === undefined) {
                    delete addr[i];
                }
            }

            //balance property should not be saved
            delete addr.balance;

            out += JSON.stringify(addr) + ',\n';

            atLeastOne = true;
        }

        if (atLeastOne) {
            out = out.substring(0, out.length-2);
        }

        out += "\n	]";

        if (nKeys(address_book) > 0) {
            out += ',\n	"address_book" : [\n';

            for (var key in address_book) {
                out += '	{"addr" : "'+ key +'",\n';
                out += '	 "label" : "'+ address_book[key] + '"},\n';
            }

            //Remove the extra comma
            out = out.substring(0, out.length-2);

            out += "\n	]";
        }

        if (nKeys(tx_notes) > 0) {
            out += ',\n	"tx_notes" : ' + JSON.stringify(tx_notes)
        }

        out += '\n}';

        //Write the address book

        return out;
    }

    this.get_history = function(success, error) {
        BlockchainAPI.get_history(function(data) {

            parseMultiAddressJSON(data, false);

            //Rebuild the my-addresses list with the new updated balances (Only if visible)
            buildVisibleView();

            if (success) success();

        }, function() {
            if (error) error();

        }, tx_filter, tx_page);
    }

    this.deleteAddressBook = function(addr) {
        delete address_book[addr];

        backupWalletDelayed();

        $('#send-coins').find('.tab-pane').trigger('show', true);
    }

    function buildSendTxView(reset) {
        $('#send-coins').find('.tab-pane.active').trigger('show', reset);

        if (reset) {
            BlockchainAPI.get_ticker();

            $('.send').prop('disabled', false);
        }
    }

    function buildSelect(select, zero_balance, reset) {
        var old_val = select.val();

        select.empty();

        for (var key in addresses) {
            var addr = addresses[key];

            //Don't include archived addresses
            if (!addr || addr.tag == 2)
                continue;

            var label = addr.label;

            if (!label)
                label = addr.addr.substring(0, 15) + '...';

            if (zero_balance || addr.balance > 0) {
                //On the sent transactions page add the address to the from address options
                select.prepend('<option value="'+addr.addr+'">' + label + ' - ' + formatBTC(addr.balance) + '</option>');
            }
        }

        select.prepend('<option value="any" selected>Any Address</option>');

        if (!reset && old_val)
            select.val(old_val);
    }

    function buildSendForm(el, reset) {
        buildSelect(el.find('select[name="from"]'), false, reset);

        buildSelect(el.find('select[name="change"]'), true, reset);

        el.find('select[name="change"]').prepend('<option value="new">New Address</option>');

        el.find('.local-symbol').text(symbol_local.symbol);

        el.find('.btc-symbol').text(symbol_btc.symbol);

        if (reset) {
            el.find('input').val('');
            el.find('.send-value-usd').text(formatSymbol(0, symbol_local)).val('');
            el.find('.amount-needed').text(0);
        }

        var recipient_container = el.find(".recipient-container");

        if (reset) {
            var first_child = recipient_container.find(".recipient:first-child").clone();

            recipient_container.empty().append(first_child);
        }

        function totalValueBN() {
            var total_value = BigInteger.ZERO;
            el.find('input[name="send-value"]').each(function(){
                total_value = total_value.add(precisionToSatoshiBN($(this).val()));
            });
            return total_value;
        }

        function bindRecipient(recipient) {

            recipient.find('input[name="send-to-address"]').typeahead({
                source : getActiveLabels()
            }).next().click(function() {
                    var input = $(this).prev();
                    MyWallet.scanQRCode(function(data) {
                        console.log(data);

                        try {
                            new Bitcoin.Address(data);

                            input.val(data);
                        } catch (e) {

                            //If invalid address try and parse URI
                            handleURI(data, recipient);
                        }
                    }, function(e) {
                        MyWallet.makeNotice('error', 'misc-error', e);
                    });
                });

            recipient.find('input[name="send-value"]').unbind().bind('keyup change', function(e) {
                if (e.keyCode == '9') {
                    return;
                }

                el.find('.amount-needed').text(formatBTC(totalValueBN().toString()));

                recipient.find('.send-value-usd').val(convert($(this).val() *  symbol_btc.conversion, symbol_local.conversion)).text(formatSymbol($(this).val() *  symbol_btc.conversion, symbol_local));
            });

            recipient.find('.send-value-usd').text(formatSymbol(0, symbol_local)).unbind().bind('keyup change', function(e) {
                if (e.keyCode == '9') {
                    return;
                }

                recipient.find('input[name="send-value"]').val(formatSatoshi(parseFloat($(this).val()) * symbol_local.conversion, sShift(symbol_btc), true));
            });
        }

        recipient_container.find(".recipient").each(function(){
            bindRecipient($(this));
        });

        el.find('.remove-recipient').unbind().click(function() {
            var n = recipient_container.find(".recipient").length;

            if (n > 1) {
                if (n == 2)
                    $(this).hide(200);

                recipient_container.find(".recipient:last-child").remove();
            }
        });

        el.find('.add-recipient').unbind().click(function() {
            var recipient = recipient_container.find(".recipient:first-child").clone();

            recipient.appendTo(recipient_container);

            bindRecipient(recipient);

            el.find('.remove-recipient').show(200);
        });
    }

    this.getAllAddresses = function() {
        var array = [];
        for (var key in addresses) {
            array.push(key);
        }
        return array;
    }

    //Find the preferred address to use for change
    //Order deposit / request coins
    this.getPreferredAddress = function() {
        var preferred = null;
        for (var key in addresses) {
            var addr = addresses[key];

            if (preferred == null)
                preferred = addr;

            if (addr.priv != null) {
                if (preferred == null)
                    preferred = addr;

                if (addr.tag == null || addr.tag == 0) {
                    preferred = addr;
                    break;
                }
            }
        }

        return preferred.addr;
    }


    function backupInstructionsModal() {
        var modal = $('#restore-backup-modal');

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });

        modal.find('.btn.btn-secondary').unbind().click(function() {
            modal.modal('hide');
        });
    }

    this.scanQRCode = function(success, error) {

        var modal = $('#qr-code-reader-modal');

        modal.modal({
            keyboard: false,
            backdrop: "static",
            show: true
        });

        //WebCam
        loadScript('wallet/qr.code.reader', function() {
            QRCodeReader.init(modal, function(data) {
                modal.modal('hide');

                success(data);
            }, function(e) {
                modal.modal('hide');

                error(e);
            });
        }, error);

        modal.find('.btn.btn-secondary').unbind().click(function() {
            QRCodeReader.stop();

            modal.modal('hide');

            error();
        });
    }

    this.getActiveAddresses = function() {
        var array = [];
        for (var key in addresses) {
            var addr = addresses[key];
            //Don't include archived addresses
            if (addr.tag != 2)
                array.push(addr.addr);
        }
        return array;
    }


    this.getArchivedAddresses = function() {
        var array = [];
        for (var key in addresses) {
            var addr = addresses[key];
            //Don't include archived addresses
            if (addr.tag == 2)
                array.push(addr.addr);
        }
        return array;
    }

    function setLatestBlock(block) {

        if (block != null) {
            latest_block = block;

            for (var key in transactions) {
                var tx = transactions[key];

                if (tx.blockHeight != null && tx.blockHeight > 0) {
                    var confirmations = latest_block.height - tx.blockHeight + 1;
                    if (confirmations <= 100) {
                        tx.setConfirmations(latest_block.height - tx.blockHeight + 1);
                    } else {
                        tx.setConfirmations(null);
                    }
                } else {
                    tx.setConfirmations(0);
                }
            }
        }
    }

    function openTransactionSummaryModal(txIndex, result) {
        loadScript('wallet/frame-modal', function() {
            showFrameModal({
                title : 'Transaction Summary',
                description : '',
                src : root + 'tx-summary/'+txIndex+'?result='+result+'&guid='+guid
            });
        });
    }

    this.deleteNote = function(tx_hash) {
        delete tx_notes[tx_hash];

        buildVisibleView();

        backupWalletDelayed();
    }

    function addNotePopover(el, tx_hash) {
        (function(el, tx_hash) {
            el = $(el);

            if (!el.data('popover')) {
                el.popover({
                    title : 'Add Note <span style="float:right"><i class="icon-remove-sign"></i></span>',
                    trigger : 'manual',
                    content : '<textarea style="width:97%;height:50px;margin-top:2px" placeholder="Enter the note here..."></textarea><div style="text-align:right"><button class="btn btn-small">Save</button></div>'
                });
            } else if (el.data('popover').tip().is(':visible'))
                return;

            el.popover('show');

            el.mouseleave(function() {
                if (!el.__timeout) {
                    el.__timeout = setTimeout(function() {
                        el.popover('hide');
                    }, 250);
                }
            });

            function clearT() {
                if (el.__timeout) {
                    clearTimeout(el.__timeout);
                    el.__timeout = null;
                }
            }

            var tip = el.data('popover').tip().mouseenter(clearT);

            tip.find('textarea').focus(clearT);

            tip.mouseleave(function() {
                el.__timeout = setTimeout(function() {
                    el.popover('hide');
                }, 250);
            });

            tip.find('i').unbind().click(function() {
                el.popover('hide');
            });


            tip.find('button').click(function() {
                //Strip HTML and replace quotes
                var note = stripHTML(tip.find('textarea').val()).replace(/'/g, '').replace(/"/g, '');

                if (note.length > 0) {
                    tx_notes[tx_hash] = note;

                    backupWalletDelayed();
                }

                buildVisibleView();
            });
        })(el, tx_hash);
    }

    function showNotePopover(el, content, tx_hash) {
        (function(el, content, tx_hash) {
            el = $(el);

            if (!el.data('popover')) {
                var title = 'Note';

                //Only if it is a custom (not public note do we show the delete button
                if (tx_notes[tx_hash])
                    title += ' <span style="float:right"><img src="'+resource+'delete.png" /></span>';

                $(el).popover({
                    title : title,
                    trigger : 'manual',
                    content : content
                })
            } else if (el.data('popover').tip().is(':visible'))
                return;

            el.popover('show');

            el.mouseleave(function() {
                if (!el.__timeout) {
                    el.__timeout = setTimeout(function() {
                        el.popover('hide');
                    }, 250);
                }
            });

            var tip = el.data('popover').tip().mouseenter(function() {
                if (el.__timeout) {
                    clearTimeout(el.__timeout);
                    el.__timeout = null;
                }
            });

            tip.find('img').unbind().click(function() {
                MyWallet.deleteNote(tx_hash);
            });

            tip.mouseleave(function() {
                el.__timeout = setTimeout(function() {
                    el.popover('hide');
                }, 250);
            });
        })(el, content, tx_hash);
    }


    function getCompactHTML(tx, myAddresses, addresses_book) {
        var result = tx.result;

        var html = '<tr class="pointer" id="tx-' + tx.txIndex + '"><td class="hidden-phone" style="width:365px"><div><ul style="margin-left:0px;" class="short-addr">';

        var all_from_self = true;
        if (result >= 0) {
            for (var i = 0; i < tx.inputs.length; ++i) {
                var out = tx.inputs[i].prev_out;

                if (!out || !out.addr) {
                    all_from_self = false;

                    html += '<span class="label">Newly Generated Coins</span>';
                } else {
                    var my_addr = myAddresses[out.addr];

                    //Don't Show sent from self
                    if (my_addr)
                        continue;

                    all_from_self = false;

                    html += formatOutput(out, myAddresses, addresses_book);
                }
            }
        } else if (result < 0) {
            for (var i = 0; i < tx.out.length; ++i) {
                var out = tx.out[i];

                var my_addr = myAddresses[out.addr];

                //Don't Show sent to self
                if (my_addr && out.type == 0)
                    continue;

                all_from_self = false;

                html += formatOutput(out, myAddresses, addresses_book);
            }
        }

        if (all_from_self)
            html += '<span class="label">Moved Between Wallet</info>';

        html += '</ul></div></td><td><div>';

        var note = tx.note ? tx.note : tx_notes[tx.hash];

        if (note) {
            html += '<img src="'+resource+'note.png" class="show-note"> ';
        } else {
            html += '<img src="'+resource+'note_grey.png" class="add-note"> ';
        }

        if (tx.time > 0) {
            html += dateToString(new Date(tx.time * 1000));
        }

        if (tx.confirmations == 0) {
            html += ' <span class="label label-important hidden-phone">Unconfirmed Transaction!</span> ';
        } else if (tx.confirmations > 0) {
            html += ' <span class="label label-info hidden-phone">' + tx.confirmations + ' Confirmations</span> ';
        }

        html += '</div></td>';

        if (result > 0)
            html += '<td style="color:green"><div>' + formatMoney(result, true) + '</div></td>';
        else if (result < 0)
            html += '<td style="color:red"><div>' + formatMoney(result, true) + '</div></td>';
        else
            html += '<td><div>' + formatMoney(result, true) + '</div></td>';

        if (tx.balance == null)
            html += '<td></td></tr>';
        else
            html += '<td class="hidden-phone"><div>' + formatMoney(tx.balance) + '</div></td></tr>';

        return html;
    };


    //Reset is true when called manually with changeview
    function buildVisibleViewPre() {
        //Hide any popovers as they can get stuck whent the element is re-drawn
        hidePopovers();

        //Update the account balance
        if (final_balance == null) {
            $('#balance').html('Loading...');
        } else {
            $('#balance').html(formatSymbol(final_balance, symbol, true));
            $('#balance2').html(formatSymbol(final_balance, (symbol === symbol_local) ? symbol_btc : symbol_local), true);
        }

        //Only build when visible
        return cVisible.attr('id');
    }

    //Reset is true when called manually with changeview
    function buildVisibleView(reset) {

        var id = buildVisibleViewPre();

        if ("send-coins" == id)
            buildSendTxView(reset);
        else if ("home-intro" == id)
            buildHomeIntroView(reset);
        else if ("receive-coins" == id)
            buildReceiveCoinsView(reset)
        else if ("my-transactions" == id)
            buildTransactionsView(reset)
    }

    function buildHomeIntroView(reset) {
        $('#summary-n-tx').html(n_tx);

        $('#summary-received').html(formatMoney(total_received, true));

        $('#summary-sent').html(formatMoney(total_sent, true));

        $('#summary-balance').html(formatMoney(final_balance, symbol));

        var preferred = MyWallet.getPreferredAddress();

        $('#tweet-for-btc').unbind().click(function() {
            window.open('https://twitter.com/share?url=https://blockchain.info/wallet&hashtags=tweet4btc,bitcoin,'+preferred+'&text=Sign Up For a Free Bitcoin Wallet @ Blockchain.info', "", "toolbar=0, status=0, width=650, height=360");
        });

        $('.paper-wallet-btn').unbind().click(function() {
            loadScript('wallet/paper-wallet', function() {
                PaperWallet.showModal();
            });
        });

        if (MyWallet.isWatchOnly(preferred)) {
            $('.no-watch-only').hide();
        } else {
            $('.no-watch-only').show();

            var primary_address = $('#my-primary-address');
            if (primary_address.text() != preferred) {
                primary_address.text(preferred);

                loadScript('wallet/jquery.qrcode', function() {
                    $('#my-primary-addres-qr-code').empty().qrcode({width: 125, height: 125, text: preferred})
                });
            }
        }
    }

    //Show a Advanced Warning, The show Import-Export Button After Main Password is Entered
    function buildImportExportView() {
        var warning = $('#export-warning').show();

        var content = $('#import-export-content').hide();

        $('#show-import-export').unbind().click(function () {
            MyWallet.getMainPassword(function() {
                warning.hide();

                loadScript('wallet/import-export', function() {
                    ImportExport.init(content, function() {
                        content.show();
                    }, function() {

                        changeView($("#home-intro"));
                    })
                }, function (e) {
                    MyWallet.makeNotice('error', 'misc-error', e);

                    changeView($("#home-intro"));
                });
            }, function() {
                changeView($("#home-intro"));
            });
        });
    };

    //Display The My Transactions view
    function buildTransactionsView() {
        var interval = null;
        var start = 0;

        if (interval != null) {
            clearInterval(interval);
            interval = null;
        }

        var txcontainer;
        if (wallet_options.tx_display == 0) {
            $('#transactions-detailed').hide();
            txcontainer = $('#transactions-compact').show().find('tbody').empty();
        } else {
            $('#transactions-compact').hide();
            txcontainer = $('#transactions-detailed').empty().show();
        }

        if (transactions.length == 0) {
            $('#transactions-detailed, #transactions-compact').hide();
            $('#no-transactions').show();
            return;
        } else {
            $('#no-transactions').hide();
        }

        var buildSome = function() {
            for (var i = start; i < transactions.length && i < (start+10); ++i) {
                var tx = transactions[i];

                if (wallet_options.tx_display == 0) {
                    txcontainer.append(bindTx($(getCompactHTML(tx, addresses, address_book)), tx));
                } else {
                    txcontainer.append(tx.getHTML(addresses, address_book));
                }
            }

            start += 10;

            if (start < transactions.length) {
                interval = setTimeout(buildSome, 15);
            } else {
                setupSymbolToggle();

                hidePopovers();

                var pagination = $('.pagination ul').empty();

                if (tx_page == 0 && transactions.length < 50) {
                    pagination.hide();
                    return;
                } else {
                    pagination.show();
                }

                var pages = Math.ceil(n_tx_filtered / 50);

                var disabled = ' disabled';
                if (tx_page > 0)
                    disabled = '';

                pagination.append($('<li class="prev'+disabled+'"><a>&larr; Previous</a></li>').click(function() {
                    MyWallet.setPage(tx_page-1);
                }));

                for (var i = 0; i < pages && i <= 10; ++i) {
                    (function(i){
                        var active = '';
                        if (tx_page == i)
                            active = ' class="active"';

                        pagination.append($('<li'+active+'><a class="hidden-phone">'+i+'</a></li>').click(function() {
                            MyWallet.setPage(i);
                        }));
                    })(i);
                }

                var disabled = ' disabled';
                if (tx_page < pages)
                    disabled = '';

                pagination.append($('<li class="next'+disabled+'"><a>Next &rarr;</a></li>').click(function() {
                    MyWallet.setPage(tx_page+1)
                }));
            }
        };

        buildSome();
    }

    this.setPage = function(i) {
        tx_page = i;

        scroll(0,0);

        MyWallet.get_history();
    }

    function exportHistory() {
        loadScript('wallet/frame-modal', function() {
            showFrameModal({
                title : 'Export History',
                description : '',
                src : root + 'export-history?active='+ MyWallet.getActiveAddresses().join('|')+'&archived='+MyWallet.getArchivedAddresses().join("|")
            });
        });
    }

    function parseMultiAddressJSON(obj, cached) {
        if (!cached && obj.mixer_fee) {
            mixer_fee = obj.mixer_fee;
        }

        if (obj.disable_mixer) {
            $('#shared-addresses,#send-shared').hide();
        }

        transactions.length = 0;

        if (obj.wallet == null) {
            total_received = 0;
            total_sent = 0;
            final_balance = 0;
            n_tx = 0;
            n_tx_filtered = 0;
            return;
        }

        total_received = obj.wallet.total_received;
        total_sent = obj.wallet.total_sent;
        final_balance = obj.wallet.final_balance;
        n_tx = obj.wallet.n_tx;
        n_tx_filtered = obj.wallet.n_tx_filtered;

        for (var i = 0; i < obj.addresses.length; ++i) {
            if (addresses[obj.addresses[i].address])
                addresses[obj.addresses[i].address].balance = obj.addresses[i].final_balance;
        }


        for (var i = 0; i < obj.txs.length; ++i) {
            var tx = TransactionFromJSON(obj.txs[i]);

            //Don't use the result given by the api because it doesn't include archived addresses
            tx.result = calcTxResult(tx, false);

            transactions.push(tx);
        }

        if (obj.info) {
            $('#nodes-connected').html(obj.info.nconnected);

            if (obj.info.latest_block)
                setLatestBlock(obj.info.latest_block);


            if (obj.info.symbol_local)
                setLocalSymbol(obj.info.symbol_local);

            if (obj.info.symbol_btc)
                setBTCSymbol(obj.info.symbol_btc);
        }
    }

    function handleURI(hash, recipient) {
        loadScript('wallet/jsuri-1.1.1', function() {
            try {
                var uri = new Uri(hash);

                var address = new Bitcoin.Address(uri.host());

                recipient.find('input[name="send-to-address"]').val(address.toString());

                var value = parseFloat(uri.getQueryParamValue('amount'));

                if (value > 0 && !isNaN(value)) {
                    recipient.find('input[name="send-value"]').val(value);
                }

            } catch (e) {
                console.log(e);

                MyWallet.makeNotice('error', 'error', 'Invalid Bitcoin Address or URI');
            }
        }, function() {
            MyWallet.makeNotice('error', 'error', 'Invalid Bitcoin Address or URI');
        });
    }

    function didDecryptWallet() {
        logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());

        for (var listener in event_listeners) {
            event_listeners[listener]('did_decrypt')
        }

        MyStore.get('multiaddr', function(multiaddrjson) {
            if (multiaddrjson != null) {
                parseMultiAddressJSON($.parseJSON(multiaddrjson), true);

                buildVisibleView();
            }
        });

        ///Get the list of transactions from the http API
        MyWallet.get_history();

        $('#initial_error,#initial_success').remove();

        var hash = decodeURIComponent(window.location.hash.replace("#", ""));
        if (hash.indexOf('bitcoin:') == 0) {

            var send_container = $("#send-coins");

            changeView(send_container);

            //Find the first recipient container
            var recipient = send_container.find('.tab-pane.active').find('.recipient').first();

            handleURI(hash, recipient);
        } else {
            changeView($("#home-intro"));
        }

        //We have dealt the the hash values, don't need them anymore
        window.location.hash = '';
    }

    //Fetch a new wallet from the server
    function getWallet(success, error) {
        for (var key in addresses) {
            var addr = addresses[key];
            if (addr.tag == 1) { //Don't fetch a new wallet if we have any keys which are marked un-synced
                alert('Warning! wallet data may have changed but cannot sync as you have un-saved keys');
                return;
            }
        }

        console.log('Get wallet with checksum ' + payload_checksum);

        var obj = {guid : guid, sharedKey : sharedKey, format : 'plain'};

        if (payload_checksum && payload_checksum.length > 0)
            obj.checksum = payload_checksum;

        $.ajax({
            type: "GET",
            url: root + 'wallet/wallet.aes.json',
            data : obj,
            success: function(data) {
                if (data == null || data.length == 0 || data == 'Not modified') {
                    if (success) success();
                    return;
                }

                console.log('Wallet data modified');

                MyWallet.setEncryptedWalletData(data);

                if (internalRestoreWallet()) {
                    MyWallet.get_history();

                    buildVisibleView();

                    if (success) success();
                } else {
                    //If we failed to decrypt the new data panic and logout
                    window.location.reload();

                    if (error) error();
                }
            },
            error : function() {
                if (error) error();
            }
        });
    }

    function internalRestoreWallet() {
        try {
            if (encrypted_wallet_data == null || encrypted_wallet_data.length == 0) {
                MyWallet.makeNotice('error', 'misc-error', 'No Wallet Data To Decrypt');
                return false;
            }

            var obj = null;
            MyWallet.decrypt(encrypted_wallet_data, password, MyWallet.getDefaultPbkdf2Iterations(), function(decrypted) {
                try {
                    obj = $.parseJSON(decrypted);

                    return (obj != null);
                } catch (e) {
                    return false;
                };
            });

            if (obj == null) {
                throw 'Error Decrypting Wallet. Please check your password is correct.';
            }

            if (obj.double_encryption && obj.dpasswordhash) {
                double_encryption = obj.double_encryption;
                dpasswordhash = obj.dpasswordhash;
            }

            if (obj.options) {
                $.extend(wallet_options, obj.options);
            }

            addresses = {};
            for (var i = 0; i < obj.keys.length; ++i) {
                var key = obj.keys[i];
                if (key.addr == null || key.addr.length == 0 || key.addr == 'undefined') {
                    MyWallet.makeNotice('error', 'null-error', 'Your wallet contains an undefined address. This is a sign of possible corruption, please double check all your BTC is accounted for. Backup your wallet to remove this error.', 15000);
                    continue;
                }

                if (key.tag == 1)
                    key.tag = null;

                addresses[key.addr] = key;
            }

            address_book = {};
            if (obj.address_book) {
                for (var i = 0; i < obj.address_book.length; ++i) {
                    MyWallet.addAddressBookEntry(obj.address_book[i].addr, obj.address_book[i].label);
                }
            }

            if (obj.tx_notes) tx_notes = obj.tx_notes;

            sharedKey = obj.sharedKey;

            if (sharedKey == null || sharedKey.length == 0 || sharedKey.length != 36)
                throw 'Shared Key is invalid';

            //If we don't have a checksum then the wallet is probably brand new - so we can generate our own
            if (payload_checksum == null || payload_checksum.length == 0)
                payload_checksum = generatePayloadChecksum();

            //We need to check if the wallet has changed
            getWallet();

            setIsIntialized();

            return true;
        } catch (e) {
            MyWallet.makeNotice('error', 'misc-error', e);
        }

        return false;
    }

    this.getPassword = function(modal, success, error) {

        if (!modal.is(':visible')) {
            modal.trigger('hidden');
            modal.unbind();
        }

        modal.modal({
            keyboard: false,
            backdrop: "static",
            show: true
        });

        //Center
        modal.center();

        var input = modal.find('input[name="password"]');

        //Virtual On-Screen Keyboard
        var $write = input,
            shift = false,
            capslock = false;

        modal.find('.vkeyboard li').unbind().click(function(){

            var $this = $(this),
                character = $this.html(); // If it's a lowercase letter, nothing happens to this variable

            // Shift keys
            if ($this.hasClass('left-shift') || $this.hasClass('right-shift')) {
                $('.letter').toggleClass('uppercase');
                $('.symbol span').toggle();

                shift = (shift === true) ? false : true;
                capslock = false;
                return false;
            }

            // Caps lock
            if ($this.hasClass('capslock')) {
                $('.letter').toggleClass('uppercase');
                capslock = true;
                return false;
            }

            // Delete
            if ($this.hasClass('delete')) {
                var html = $write.val();

                $write.val(html.substr(0, html.length - 1));
                return false;
            }

            // Special characters
            if ($this.hasClass('symbol')) character = $('span:visible', $this).html();
            if ($this.hasClass('space')) character = ' ';
            if ($this.hasClass('tab')) character = "\t";
            if ($this.hasClass('return')) character = "\n";

            // Uppercase letter
            if ($this.hasClass('uppercase')) character = character.toUpperCase();

            // Remove shift once a key is clicked.
            if (shift === true) {
                $('.symbol span').toggle();
                if (capslock === false) $('.letter').toggleClass('uppercase');

                shift = false;
            }

            // Add the character
            $write.val($write.val() + character);
        });

        input.keypress(function(e) {
            if(e.keyCode == 13) { //Pressed the return key
                e.preventDefault();
                modal.find('.btn.btn-primary').click();
            }
        });

        input.val('');

        var primary_button = modal.find('.btn.btn-primary');
        primary_button.click(function() {
            if (success) {
                error = null;

                var ccopy = success;
                success = null;

                setTimeout(function() {
                    modal.modal('hide');

                    ccopy(input.val());
                }, 10);
            } else {
                modal.modal('hide');
            }
        });

        var secondary_button = modal.find('.btn.btn-secondary');
        secondary_button.click(function() {
            if (error) {
                var ccopy = error;

                error = null;
                success = null;

                setTimeout(function() {
                    modal.modal('hide');

                    try { ccopy(); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }, 10);
            } else {
                modal.modal('hide');
            }
        });

        modal.on('hidden', function () {
            input.unbind();
            secondary_button.unbind();
            primary_button.unbind();
            modal.unbind();

            if (error) {
                var ccopy = error;

                error = null;
                success = null;

                setTimeout(function() {
                    try { ccopy(); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }, 10);
            }
        });
    }

    this.makePairingQRCode = function(success, version) {

        MyWallet.getMainPassword(function() {
            loadScript('wallet/jquery.qrcode', function() {
                try {
                    if (version == 1) {
                        MyWallet.securePost("wallet", { method : 'pairing-encryption-password' }, function(encryption_phrase) {
                            success($('<div></div>').qrcode({width: 300, height: 300, text: '1|'+ guid + '|' + MyWallet.encrypt(sharedKey + '|' + Crypto.util.bytesToHex(UTF8.stringToBytes(password)), encryption_phrase, default_pbkdf2_iterations)}));

                        }, function(e) {
                            MyWallet.makeNotice('error', 'misc-error', e);
                        });
                    } else if (version == 0) {
                        //Depreciate this ASAP
                        success($('<div></div>').qrcode({width: 300, height: 300, text: guid + '|' + sharedKey + '|' + password}));
                    }
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', e);
                }
            });
        }, function() {
            MyWallet.logout();
        });
    }

    this.getMainPassword = function(success, error) {
        //If the user has input their password recently just call the success handler
        if (last_input_main_password > new Date().getTime() - main_password_timeout)
            return success(password);

        MyWallet.getPassword($('#main-password-modal'), function(_password) {

            if (password == _password) {
                last_input_main_password = new Date().getTime();

                if (success) {
                    try { success(password); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }
            } else {
                MyWallet.makeNotice('error', 'misc-error', 'Password incorrect.');

                if (error) {
                    try { error(); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }
            }
        }, error);
    }

    this.getSecondPassword = function(success, error) {
        if (!double_encryption || dpassword != null) {
            if (success) {
                try { success(dpassword); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e);  }
            }
            return;
        }

        MyWallet.getPassword($('#second-password-modal'), function(_password) {
            try {
                if (vaidateDPassword(_password)) {
                    if (success) {
                        try { success(_password); } catch (e) { console.log(e); MyWallet.makeNotice('error', 'misc-error', e); }
                    }
                } else {
                    MyWallet.makeNotice('error', 'misc-error', 'Password incorrect.');

                    if (error) {
                        try { error(); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                    }
                }
            } catch (e) {
                if (error) {
                    try { error(); } catch (e) { MyWallet.makeNotice('error', 'misc-error', e); }
                }
            }
        }, error);
    }

    function restoreWallet() {

        if (isInitialized) {
            return;
        }

        var input_field = $("#restore-password");

        password = input_field.val();

        //Clear the password field now we are done with it
        input_field.val('');

        //Main Password times out after 10 minutes
        last_input_main_password = new Date().getTime();

        //If we don't have any wallet data then we must have two factor authentication enabled
        if (encrypted_wallet_data == null || encrypted_wallet_data.length == 0) {
            MyWallet.setLoadingText('Validating Authentication key');

            var auth_key = $.trim($('.auth-'+auth_type).find('.code').val());

            if (auth_key.length == 0 || auth_key.length > 255) {
                MyWallet.makeNotice('error', 'misc-error', 'You must enter a Two Factor Authentication code');
                return false;
            }

            $.ajax({
                type: "POST",
                url: root + "wallet",
                data :  { guid: guid, payload: auth_key, length : auth_key.length,  method : 'get-wallet', format : 'plain' },
                success: function(data) {
                    try {
                        if (data == null || data.length == 0) {
                            MyWallet.makeNotice('error', 'misc-error', 'Server Return Empty Wallet Data');
                            return;
                        }

                        MyWallet.setEncryptedWalletData(data);

                        //We can now hide the auth token input
                        $('.auth-'+auth_type).hide();

                        $('.auth-0').show();

                        if (internalRestoreWallet()) {
                            bindReady();

                            didDecryptWallet();
                        }
                    } catch (e) {
                        MyWallet.makeNotice('error', 'misc-error', e);
                    }
                },
                error : function(e) {
                    MyWallet.makeNotice('error', 'misc-error', e.responseText);
                }
            });
        } else {

            if (internalRestoreWallet()) {
                bindReady();

                didDecryptWallet();
            }
        }


        return true;
    }

    function showNotSyncedModal() {
        $('#not-synced-warning-modal').modal('show').find('.btn.btn-danger').unbind().click(function() {
            $(this).modal('hide');

            show_unsynced = true;

            buildVisibleView();
        });;

    }

    function setIsIntialized() {
        setLogoutImageStatus('error');

        webSocketConnect(wsSuccess);

        isInitialized = true;

        $('#tech-faq').hide();

        $('#intro-text').hide();

        $('#large-summary').show();
    }

    this.quickSendNoUI = function(to, value, listener) {
        loadScript('wallet/signer', function() {
            MyWallet.getSecondPassword(function() {
                try {
                    var obj = initNewTx();

                    obj.from_addresses = MyWallet.getActiveAddresses();

                    obj.to_addresses.push({address: new Bitcoin.Address(to), value :  Bitcoin.Util.parseValue(value)});

                    obj.addListener(listener);

                    obj.start();
                } catch (e){
                    listener.on_error(e);
                }
            }, function(e) {
                listener.on_error(e);
            });
        });
    }

    function emailBackup() {
        MyWallet.setLoadingText('Sending email backup');

        $.ajax({
            type: "POST",
            url: root + 'wallet',
            data : { guid: guid, sharedKey: sharedKey, method : 'email-backup', format : 'plain' },
            success: function(data) {
                MyWallet.makeNotice('success', 'backup-success', data);
            },
            error : function(e) {
                MyWallet.makeNotice('error', 'misc-error', e.responseText);
            }
        });
    }

//Can call multiple times in a row and it will backup only once after a certain delay of activity
    function backupWalletDelayed(method, success, error, extra) {
        if (archTimer) {
            clearInterval(archTimer);
            archTimer = null;
        }

        archTimer = setTimeout(function (){
            MyWallet.backupWallet(method, success, error, extra);
        }, 3000);
    }

//Save the javascript walle to the remote server
    this.backupWallet = function(method, successcallback, errorcallback) {
        if (archTimer) {
            clearInterval(archTimer);
            archTimer = null;
        }

        try {
            if (method == null)
                method = 'update';

            if (nKeys(addresses) == 0)
                return;

            var data = MyWallet.makeWalletJSON();

            //Everything looks ok, Encrypt the JSON output
            var crypted = MyWallet.encrypt(data, password, default_pbkdf2_iterations);

            if (crypted.length == 0) {
                throw 'Error encrypting the JSON output';
            }

            //Now Decrypt the it again to double check for any possible corruption
            var obj = null;
            MyWallet.decrypt(crypted, password, MyWallet.getDefaultPbkdf2Iterations(), function(decrypted) {
                try {
                    obj = $.parseJSON(decrypted);
                    return (obj != null);
                } catch (e) {
                    return false;
                };
            });

            if (obj == null) {
                throw 'Error Decrypting Previously encrypted JSON. Not Saving Wallet.';
            }

            var old_checksum = payload_checksum;

            MyWallet.setLoadingText('Saving wallet');

            MyWallet.setEncryptedWalletData(crypted);

            $.ajax({
                type: "POST",
                url: root + 'wallet',
                data: { guid: guid, length: crypted.length, payload: crypted, sharedKey: sharedKey, checksum: payload_checksum, old_checksum : old_checksum,  method : method },
                converters: {"* text": window.String, "text html": true, "text json": window.String, "text xml": window.String},
                success: function(data) {

                    var change = false;
                    for (var key in addresses) {
                        var addr = addresses[key];
                        if (addr.tag == 1) {
                            addr.tag = null; //Make any unsaved addresses as saved
                            change = true;
                        }
                    }

                    MyWallet.makeNotice('success', 'misc-success', data);

                    buildVisibleView();

                    if (successcallback != null)
                        successcallback();
                },
                error : function(data) {

                    for (var key in addresses) {
                        var addr = addresses[key];
                        if (addr.tag == 1) {
                            showNotSyncedModal();
                            break;
                        }
                    }

                    if (data.responseText == null)
                        MyWallet.makeNotice('error', 'misc-error', 'Error Saving Wallet', 10000);
                    else
                        MyWallet.makeNotice('error', 'misc-error', data.responseText, 10000);

                    buildVisibleView();

                    if (errorcallback != null)
                        errorcallback();
                }
            });
        } catch (e) {
            MyWallet.makeNotice('error', 'misc-error', 'Error Saving Wallet: ' + e, 10000);

            buildVisibleView();

            if (errorcallback != null)
                errorcallback(e);
            else throw e;
        }
    }

    function encryptPK(base58) {
        if (double_encryption) {
            if (dpassword == null)
                throw 'Cannot encrypt private key without a password';

            return MyWallet.encrypt(base58, sharedKey + dpassword, wallet_options.pbkdf2_iterations);
        } else {
            return base58;
        }

        return null;
    }

    this.isBase58 = function(str, base) {
        for (var i = 0; i < str.length; ++i) {
            if (str[i] < 0 || str[i] > 58) {
                return false;
            }
        }
        return true;
    }

//Changed padding to CBC iso10126 9th March 2012 & iterations to pbkdf2_iterations
    this.encrypt = function(data, password, pbkdf2_iterations) {
        return Crypto.AES.encrypt(data, password, { mode: new Crypto.mode.CBC(Crypto.pad.iso10126), iterations : pbkdf2_iterations});
    }

//When the ecryption format changes it can produce data which appears to decrypt fine but actually didn't
//So we call success(data) and if it returns true the data was formatted correctly
    this.decrypt = function(data, password, pbkdf2_iterations, success, error) {

        //iso10126 with pbkdf2_iterations iterations
        try {
            var decoded = Crypto.AES.decrypt(data, password, { mode: new Crypto.mode.CBC(Crypto.pad.iso10126), iterations : pbkdf2_iterations});

            if (decoded != null && decoded.length > 0) {
                if (success(decoded)) {
                    return decoded;
                };
            };
        } catch (e) {
            console.log(e);
        }

        //iso10126 with 10 iterations  (old default)
        if (pbkdf2_iterations != 10) {
            try {
                var decoded = Crypto.AES.decrypt(data, password, { mode: new Crypto.mode.CBC(Crypto.pad.iso10126), iterations : 10 });

                if (decoded != null && decoded.length > 0) {
                    if (success(decoded)) {
                        return decoded;
                    };
                };
            } catch (e) {
                console.log(e);
            }
        }

        //Otherwise try the old default settings
        try {
            var decoded = Crypto.AES.decrypt(data, password);

            if (decoded != null && decoded.length > 0) {
                if (success(decoded)) {
                    return decoded;
                };
            };
        } catch (e) {
            console.log(e);
        }

        //OFB iso7816 padding with one iteration (old default)
        try {
            var decoded = Crypto.AES.decrypt(data, password, {mode: new Crypto.mode.OFB(Crypto.pad.iso7816), iterations : 1});

            if (decoded != null && decoded.length > 0) {
                if (success(decoded)) {
                    return decoded;
                };
            };
        } catch (e) {
            console.log(e);
        }

        //iso10126 padding with one iteration (old default)
        try {
            var decoded = Crypto.AES.decrypt(data, password, { mode: new Crypto.mode.CBC(Crypto.pad.iso10126), iterations : 1 });

            if (decoded != null && decoded.length > 0) {
                if (success(decoded)) {
                    return decoded;
                };
            };
        } catch (e) {
            console.log(e);
        }

        if (error != null)
            error();

        return null;
    }


    //Fetch information on a new wallet identfier
    this.setGUID = function(guid_or_alias, resend_code) {

        console.log('Set GUID ' + guid_or_alias);

        if (isInitialized) {
            throw 'Cannot Set GUID Once Initialized';
        }

        MyWallet.setLoadingText('Changing Wallet Identifier');

        $('#initial_error,#initial_success').remove();

        var open_wallet_btn = $('#restore-wallet-continue');

        open_wallet_btn.prop('disabled', true);

        $.ajax({
            type: "GET",
            dataType: 'json',
            url: root + 'wallet/'+guid_or_alias,
            data : {format : 'json', resend_code : resend_code},
            success: function(obj) {
                open_wallet_btn.prop('disabled', false);

                $('.auth-'+auth_type).hide();

                extra_seed = obj.extra_seed;
                guid = obj.guid;
                auth_type = obj.auth_type;
                real_auth_type = obj.real_auth_type;

                if (obj.language)
                    language = obj.language;

                MyWallet.setEncryptedWalletData(obj.payload);

                war_checksum = obj.war_checksum;

                setLocalSymbol(obj.symbol_local);

                $('#restore-guid').val(guid);

                $('.auth-'+auth_type).show();

                $('.recover-wallet-btn').prop('disabled', false).click(function() {
                    window.location = root + 'wallet/forgot-password?guid='+guid
                });

                $('#reset-two-factor-btn').prop('disabled', false).show().click(function() {
                    window.location = root + 'wallet/reset-two-factor?guid='+guid
                });

                if (obj.initial_error)
                    MyWallet.makeNotice('error', 'misc-error', obj.initial_error);

                if (obj.initial_success)
                    MyWallet.makeNotice('success', 'misc-success', obj.initial_success);

                MyStore.get('guid', function(local_guid) {
                    if (local_guid != guid) {
                        MyStore.clear();

                        //Demo Account Guid
                        if (guid != demo_guid) {
                            MyStore.put('guid', guid);
                        }
                    }
                });
            },
            error : function(e) {
                console.log('Set GUID Success');

                open_wallet_btn.prop('disabled', false);

                MyStore.get('guid', function(local_guid) {
                    if (local_guid == guid_or_alias && encrypted_wallet_data) {
                        MyWallet.makeNotice('error', 'misc-error', 'Error Contacting Server. Using Local Wallet Cache.');

                        //Generate a new Checksum
                        guid = local_guid;
                        payload_checksum = generatePayloadChecksum();
                        auth_type = 0;

                        $('#restore-guid').val(guid);

                        $('.auth-'+auth_type).show();

                        return;
                    }

                    try {
                        var obj = $.parseJSON(e.responseText);

                        if (obj.initial_error) {
                            MyWallet.makeNotice('error', 'misc-error', obj.initial_error);
                            return;
                        }
                    } catch (e) {}

                    if (e.responseText)
                        MyWallet.makeNotice('error', 'misc-error', e.responseText);
                    else
                        MyWallet.makeNotice('error', 'misc-error', 'Error changing wallet identifier');
                });
            }
        });
    }


    function encodePK(priv) {
        var base58 = B58.encode(priv);
        return encryptPK(base58);
    }

    this.decryptPK = function(priv) {
        if (double_encryption) {
            if (dpassword == null)
                throw 'Cannot decrypt private key without a password';

            return MyWallet.decrypt(priv, sharedKey + dpassword, wallet_options.pbkdf2_iterations, MyWallet.isBase58);
        } else {
            return priv;
        }

        return null;
    }

    this.decodePK = function(priv) {
        if (!priv) throw 'null PK passed to decodePK';

        var decrypted = MyWallet.decryptPK(priv);
        if (decrypted != null) {
            return B58.decode(decrypted);
        }
        return null;
    }

    this.signmessage = function(address, message) {
        var addr = addresses[address];

        if (!addr.priv)
            throw 'Cannot sign a watch only address';

        var decryptedpk = MyWallet.decodePK(addr.priv);

        var key = new Bitcoin.ECKey(decryptedpk);

        return Bitcoin.Message.signMessage(key, message, addr.addr);
    }

    function vaidateDPassword(input) {
        var thash = Crypto.SHA256(sharedKey + input, {asBytes: true});

        var password_hash = hashPassword(thash, wallet_options.pbkdf2_iterations-1);  //-1 because we have hashed once in the previous line

        if (password_hash == dpasswordhash) {
            dpassword = input;
            return true;
        }

        //Try 10 rounds
        if (wallet_options.pbkdf2_iterations != 10) {
            var iter_10_hash = hashPassword(thash, 10-1);  //-1 because we have hashed once in the previous line

            if (iter_10_hash == dpasswordhash) {
                dpassword = input;
                dpasswordhash = password_hash;
                return true;
            }
        }

        //Otherwise try SHA256 + salt
        if (Crypto.util.bytesToHex(thash) == dpasswordhash) {
            dpassword = input;
            dpasswordhash = password_hash;
            return true;
        }

        //Legacy as I made a bit of a mistake creating a SHA256 hash without the salt included
        var leghash = Crypto.SHA256(input);

        if (leghash == dpasswordhash) {
            dpassword = input;
            dpasswordhash = password_hash;
            return true;
        }

        return false;
    }

    this.runCompressedCheck = function() {
        var to_check = [];
        var key_map = {};

        for (var key in addresses) {
            var addr = addresses[key];

            if (addr.priv != null) {
                var decryptedpk = MyWallet.decodePK(addr.priv);

                var privatekey = new Bitcoin.ECKey(decryptedpk);

                var uncompressed_address = privatekey.getBitcoinAddress().toString();
                var compressed_address = privatekey.getBitcoinAddressCompressed().toString();

                if (addr.addr != uncompressed_address) {
                    key_map[uncompressed_address] = addr.priv;
                    to_check.push(uncompressed_address);
                }

                if (addr.addr != compressed_address) {
                    key_map[compressed_address] = addr.priv;
                    to_check.push(compressed_address);
                }
            }
        }

        if (to_check.length == 0) {
            alert('to_check length == 0');
        }

        BlockchainAPI.get_balances(to_check, function(results) {
            var total_balance = 0;
            for (var key in results) {
                var balance = results[key].final_balance;
                if (balance > 0) {
                    alert(formatBTC(balance) + ' claimable in address ' + key + ' (Import PK : ' + MyWallet.base58ToSipa(key_map[key], key) + ')');
                }
                total_balance += balance;
            }

            alert(formatBTC(balance) + ' found in compressed addresses');
        });
    }

    //Check the integreity of all keys in the wallet
    this.checkAllKeys = function(reencrypt) {
        for (var key in addresses) {
            var addr = addresses[key];

            if (addr.addr == null)
                throw 'Null Address Found in wallet ' + key;

            //Will throw an exception if the checksum does not validate
            if (addr.addr.toString() == null)
                throw 'Error decoding wallet address ' + addr.addr;

            if (addr.priv != null) {
                var decryptedpk = MyWallet.decodePK(addr.priv);

                var privatekey = new Bitcoin.ECKey(decryptedpk);

                var actual_addr = privatekey.getBitcoinAddress().toString();
                if (actual_addr != addr.addr && privatekey.getBitcoinAddressCompressed().toString() != addr.addr) {
                    throw 'Private key does not match bitcoin address ' + addr.addr + " != " + actual_addr;
                }

                if (reencrypt) {
                    addr.priv = encodePK(decryptedpk);
                }
            }
        }

        MyWallet.makeNotice('success', 'wallet-success', 'Wallet verified.');
    }

    this.setMainPassword = function(new_password) {
        MyWallet.getMainPassword(function() {
            password = new_password;

            MyWallet.backupWallet('update', function() {
                MyWallet.logout();
            }, function() {
                MyWallet.logout();
            });
        });
    }

    function changeView(id) {
        if (id === cVisible)
            return;

        if (cVisible != null) {
            if ($('#' + cVisible.attr('id') + '-btn').length > 0)
                $('#' + cVisible.attr('id') + '-btn').parent().attr('class', '');

            cVisible.hide();
        }

        cVisible = id;

        cVisible.show();

        if ($('#' + cVisible.attr('id') + '-btn').length > 0)
            $('#' + cVisible.attr('id') + '-btn').parent().attr('class', 'active');

        buildVisibleView(true);
    }

    function nKeys(obj) {
        var size = 0, key;
        for (key in obj) {
            size++;
        }
        return size;
    };

    function internalDeletePrivateKey(addr) {
        addresses[addr].priv = null;
    }

    function walletIsFull() {
        if (nKeys(addresses) >= maxAddr) {
            MyWallet.makeNotice('error', 'misc-error', 'We currently support a maximum of '+maxAddr+' private keys, please remove some unused ones.');
            return true;
        }

        return false;
    }

//Address (String), priv (base58 String), compresses boolean
    function internalAddKey(addr, priv) {
        var existing = addresses[addr];
        if (!existing || existing.length == 0) {
            addresses[addr] = {addr : addr, priv : priv, balance : 0};
            return true;
        } else if (!existing.priv && priv) {
            existing.priv = priv;
            return true;
        }
        return false;
    }

    function addAddressBookModal() {
        var modal = $('#add-address-book-entry-modal');

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });

        var labelField = modal.find('input[name="label"]');

        var addrField = modal.find('input[name="address"]');

        labelField.val('');
        addrField.val('');

        //Added address book button
        modal.find('.btn.btn-primary').unbind().click(function() {

            modal.modal('hide');

            var label = stripHTML(labelField.val());
            var bitcoinAddress = stripHTML(addrField.val());

            if (label.length == 0 || bitcoinAddress.length == 0) {
                MyWallet.makeNotice('error', 'misc-error', 'You must enter an address and label for the address book entry');
                return false;
            }

            var addr;
            try {
                addr = new Bitcoin.Address(bitcoinAddress);

                if (addr == null)
                    throw 'Null address';

            } catch (e) {
                MyWallet.makeNotice('error', 'misc-error', 'Bitcoin address invalid, please make sure you entered it correctly');
                return false;
            }

            if (address_book[bitcoinAddress] != null) {
                MyWallet.makeNotice('error', 'misc-error', 'Bitcoin address already exists');
                return false;
            }

            MyWallet.makeNotice('success', 'misc-success', 'Added Address book entry');

            MyWallet.addAddressBookEntry(bitcoinAddress, label);

            backupWalletDelayed();

            $('#send-coins').find('.tab-pane').trigger('show', true);
        });

        modal.find('.btn.btn-secondary').unbind().click(function() {
            modal.modal('hide');
        });
    }

    this.logout = function() {
        if (logout_timeout)
            clearTimeout(logout_timeout);

        if (guid == demo_guid) {
            window.location = root + 'wallet/logout';
        } else {
            $.ajax({
                type: "GET",
                url: root + 'wallet/logout',
                data : {format : 'plain'},
                success: function(data) {
                    window.location.reload();
                },
                error : function() {
                    window.location.reload();
                }
            });
        }
    }

    function deleteAddresses(addrs) {

        var modal = $('#delete-address-modal');

        modal.modal({
            keyboard: true,
            backdrop: "static",
            show: true
        });

        modal.find('.btn.btn-primary').hide();
        modal.find('.btn.btn-danger').hide();

        $('#change-mind').hide();

        modal.find('#to-delete-address').html(addrs.join(' '));

        modal.find('#delete-balance').empty();

        var dbalance = modal.find('#delete-balance');

        var addrs_with_priv = [];
        for (var i in addrs) {
            var address_string = addrs[i];
            if (addresses[address_string] && addresses[address_string].priv)
                addrs_with_priv.push(addrs[i]);
        }

        BlockchainAPI.get_balance(addrs_with_priv, function(data) {

            modal.find('.btn.btn-primary').show(200);
            modal.find('.btn.btn-danger').show(200);

            dbalance.html('Balance ' + formatBTC(data));

            if (data > 0)
                dbalance.css('color', 'red');
            else
                dbalance.css('color', 'black');


        }, function() {

            modal.find('.btn.btn-primary').show(200);
            modal.find('.btn.btn-danger').show(200);

            dbalance.text('Error Fetching Balance');
        });

        var isCancelled = false;
        var i = 0;
        var interval = null;
        var changeMindTime = 10;

        changeMind = function() {
            $('#change-mind').show();
            $('#change-mind-time').text(changeMindTime - i);
        };

        modal.find('.btn.btn-primary').unbind().click(function() {

            changeMind();

            modal.find('.btn.btn-primary').hide();
            modal.find('.btn.btn-danger').hide();

            interval = setInterval(function() {

                if (isCancelled)
                    return;

                ++i;

                changeMind();

                if (i == changeMindTime) {
                    //Really delete address
                    $('#delete-address-modal').modal('hide');

                    MyWallet.makeNotice('warning', 'warning-deleted', 'Private Key Removed From Wallet');

                    for (var ii in addrs) {
                        internalDeletePrivateKey(addrs[ii]);
                    }

                    //Update view with remove address
                    buildVisibleView();

                    MyWallet.backupWallet();

                    clearInterval(interval);
                }

            }, 1000);
        });

        modal.find('.btn.btn-danger').unbind().click(function() {

            changeMind();

            modal.find('.btn.btn-primary').hide();
            modal.find('.btn.btn-danger').hide();

            interval = setInterval(function() {

                if (isCancelled)
                    return;

                ++i;

                changeMind();

                if (i == changeMindTime) {
                    try {
                        //Really delete address
                        $('#delete-address-modal').modal('hide');

                        MyWallet.makeNotice('warning', 'warning-deleted', 'Address & Private Key Removed From Wallet');

                        for (var ii in addrs) {
                            MyWallet.deleteAddress(addrs[ii]);
                        }

                        buildVisibleView();

                        MyWallet.backupWallet('update', function() {
                            MyWallet.get_history();
                        });

                    } finally {
                        clearInterval(interval);
                    }
                }

            }, 1000);
        });

        modal.unbind().on('hidden', function () {
            if (interval) {
                isCancelled = true;
                clearInterval(interval);
                interval = null;
            }
        });

        modal.find('.btn.btn-secondary').unbind().click(function() {
            modal.modal('hide');
        });
    }

    function getActiveLabels() {
        var labels = [];
        for (var key in address_book) {
            labels.push(address_book[key]);
        }
        for (var key in addresses) {
            var addr =  addresses[key];
            if (addr.tag != 2 && addr.label)
                labels.push(addr.label);
        }
        return labels;
    }

    function sweepAddresses(addresses) {
        MyWallet.getSecondPassword(function() {
            var modal = $('#sweep-address-modal');

            modal.modal('show');


            BlockchainAPI.get_balance(addresses, function(data) {
                modal.find('.balance').text('Amount: ' + formatBTC(data));
            }, function() {
                modal.find('.balance').text('Error Fetching Balance');
            });

            var sweepSelect = modal.find('select[name="change"]');

            buildSelect(sweepSelect, true);

            modal.find('.btn.btn-primary').unbind().click(function() {
                loadScript('wallet/signer', function() {
                    BlockchainAPI.get_balance(addresses, function(value) {
                        var obj = initNewTx();

                        obj.fee = obj.base_fee; //Always include a fee
                        obj.to_addresses.push({address: new Bitcoin.Address($.trim(sweepSelect.val())), value : BigInteger.valueOf(value).subtract(obj.fee)});
                        obj.from_addresses = addresses;

                        obj.start();

                    }, function() {
                        MyWallet.makeNotice('error', 'misc-error', 'Error Getting Address Balance');
                    });
                });

                modal.modal('hide');
            });

            modal.find('.btn.btn-secondary').unbind().click(function() {
                modal.modal('hide');
            });
        });
    }

    function buildPopovers() {
        try {
            $(".pop").popover({
                offset: 10,
                placement : 'bottom'
            });
        } catch(e) {}
    }

    function bindReady() {

        $('#add-address-book-entry-btn').click(function() {
            addAddressBookModal();
        });

        $("#home-intro-btn").click(function() {
            changeView($("#home-intro"));
        });

        $("#my-transactions-btn").click(function() {
            changeView($("#my-transactions"));
        });

        $("#send-coins-btn").click(function() {
            changeView($("#send-coins"));
        });

        $("#import-export-btn").click(function() {
            changeView($("#import-export"));

            buildImportExportView();
        });

        $('#chord-diagram').click(function() {
            window.open(root + 'taint/' + MyWallet.getActiveAddresses().join('|'), null, "width=850,height=850");
        });

        $('#verify-message').click(function() {
            loadScript('wallet/address_modal', function() {
                verifyMessageModal();
            });
        });

        $('#generate-cold-storage').click(function() {
            loadScript('wallet/paper-wallet', function() {
                PaperWallet.showColdStorageModal();
            }, null, true);
        });

        $('#group-received').click(function() {
            loadScript('wallet/taint_grouping', function() {
                try{
                    loadTaintData();
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', 'Unable To Load Taint Grouping Data');
                }
            });
        });

        $("#my-account-btn").click(function() {
            changeView($("#my-account"));

            var warning = $('#account-settings-warning').show();

            var content = $('#my-account-content').hide();

            $('#show-account-settings').unbind().click(function () {
                MyWallet.getMainPassword(function() {
                    warning.hide();

                    loadScript('wallet/account', function() {
                        AccountSettings.init(content, function() {
                            content.show();
                        }, function() {
                            changeView($("#home-intro"));
                        })
                    }, function (e) {
                        MyWallet.makeNotice('error', 'misc-error', e);

                        changeView($("#home-intro"));
                    });
                }, function() {
                    changeView($("#home-intro"));
                });
            });
        });

        $('#enable_archived_checkbox').change(function() {
            var enabled = $(this).is(':checked');

            $('.archived_checkbox').prop('checked', false);

            $('.archived_checkbox').prop('disabled', !enabled);

            $('#archived-sweep').prop('disabled', !enabled);

            $('#archived-delete').prop('disabled', !enabled);
        });

        $('#shared-addresses').on('show', function() {
            var self = $(this);
            loadScript('wallet/shared-addresses', function() {
                buildSharedTable(self);
            });
        });

        $('#active-addresses').on('show', function() {
            var table = $(this).find('table:first');

            table.find("tbody:gt(0)").remove();

            var tbody = table.find('tbody').empty();

            for (var key in addresses) {
                var addr = addresses[key];

                //Hide Archived or un-synced
                if (addr.tag == 2 || (addr.tag == 1 && !show_unsynced))
                    continue;

                var noPrivateKey = '';

                if (addr.tag == 1) {
                    noPrivateKey = ' <font color="red" class="pop" title="Not Synced" data-content="This is a new address which has not yet been synced with our the server. Do not used this address yet.">(Not Synced)</font>';
                } else if (addr.priv == null) {
                    noPrivateKey = ' <font color="red" class="pop" title="Watch Only" data-content="Watch Only means there is no private key associated with this bitcoin address. <br /><br /> Unless you have the private key stored elsewhere you do not own the funds at this address and can only observe the transactions.">(Watch Only)</font>';
                }

                var extra = '';
                var label = addr.addr;
                if (addr.label != null) {
                    label = addr.label;
                    extra = '<span class="hidden-phone"> - ' + addr.addr + '</span>';
                }

                var action_tx = $('<tr><td><div class="short-addr"><a href="'+root+'address/'+addr.addr+'" target="new">' + label + '</a>'+ extra + ' ' + noPrivateKey +'<div></td><td><span style="color:green">' + formatMoney(addr.balance, true) + '</span></td>\
            <td><div class="btn-group pull-right"><a class="btn btn-mini dropdown-toggle" data-toggle="dropdown" href="#"><span class="hidden-phone">Actions </span><span class="caret"></span></a><ul class="dropdown-menu"> \
            <li><a href="#" class="pop act-archive" title="Archive Address" data-content="Click this button to hide the address from the main view. You can restore or delete later by finding it in the Archived addresses tab.">Archive Address</a></li>\
            <li><a href="#" class="pop act-label" title="Label Address" data-content="Set the label for this address.">Label Address</a></li>\
            <li><a href="#" class="pop act-qr" title="Show QR Code" data-content="Show a QR Code for this address.">QR Code</a></li>\
            <li><a href="#" class="pop act-sign" title="Sign Message" data-content="Sign A message with this address.">Sign Message</a></li>\
            <li><a href="#" class="pop act-request" title="Request Payment" data-content="Click here to create a new QR Code payment request. The QR Code can be scanned using most popular bitcoin software and mobile apps.">Create Payment Request</a></li>\
            <li><a href="#" class="pop act-pubkey">Show Public Key</a></li>\
            </ul></div></td></tr>');

                (function(address) {
                    action_tx.find('.act-archive').click(function() {
                        MyWallet.archiveAddr(address);
                    });

                    action_tx.find('.act-label').click(function() {
                        loadScript('wallet/address_modal', function() {
                            showLabelAddressModal(address);
                        });
                    });

                    action_tx.find('.act-qr').click(function() {
                        loadScript('wallet/address_modal', function() {
                            showAddressModalQRCode(address);
                        });
                    });

                    action_tx.find('.act-pubkey').click(function() {
                        MyWallet.getSecondPassword(function() {
                            var priv = MyWallet.getPrivateKey(address);

                            if (priv == null) {
                                MyWallet.makeNotice('eror', 'misc-error', 'Public Key Unknown');
                                return;
                            }

                            var key = new Bitcoin.ECKey(MyWallet.decodePK(priv));

                            if (key.getBitcoinAddressCompressed().toString() == address) {
                                var pub = key.getPubCompressed();
                            } else {
                                var pub = key.getPub();
                            }

                            MyWallet.makeNotice('success', 'pub-key', 'Public Key of '+ address +' is ' + Crypto.util.bytesToHex(pub), 20000);

                        });
                    });

                    action_tx.find('.act-sign').click(function() {
                        loadScript('wallet/address_modal', function() {
                            showAddressModalSignMessage(address);
                        });
                    });

                    action_tx.find('.act-request').click(function() {
                        loadScript('wallet/frame-modal', function() {
                            showFrameModal({
                                title : 'Create Payment Request',
                                description : 'Request Payment into address <b>'+address+'</b>',
                                src : root + 'payment_request?address='+address
                            });
                        });
                    });
                })(addr.addr);

                if (addr.balance > 0 && addr.priv)  {
                    table.prepend(action_tx);
                } else {
                    table.append(action_tx);
                }
            }

            buildPopovers();
        });

        $('#archived-addresses').on('show', function() {

            $('#enable_archived_checkbox').prop('checked', false);
            $('#archived-delete').prop('disabled', true);
            $('#archived-sweep').prop('disabled', true);
            $('#archived-addr tbody').empty();

            var table = $(this).find('tbody');

            var archived = MyWallet.getArchivedAddresses();

            var build = function() {
                table.empty();

                for (var key in archived) {
                    var addr = addresses[archived[key]];

                    //Hide none archived and unsynced
                    if (addr.tag != 2 || (addr.tag == 1 && !show_unsynced))
                        continue;

                    var noPrivateKey = '';
                    if (addr.priv == null) {
                        noPrivateKey = ' <font color="red">(Watch Only)</font>';
                    }

                    var extra = '';
                    var label = addr.addr;
                    if (addr.label != null) {
                        label = addr.label;
                        extra = '<span class="hidden-phone"> - ' + addr.addr + '</span>';
                    }

                    var tr = $('<tr><td style="width:20px;"><input type="checkbox" class="archived_checkbox" value="'+addr.addr+'" disabled></td><td><div class="short-addr"><a href="'+root+'address/'+addr.addr+'" target="new">' + label + '</a>'+ extra + ' ' + noPrivateKey +'<div></td><td><span style="color:green">' + formatBTC(addr.balance) + '</span></td><td style="width:16px"><img src="'+resource+'unarchive.png" class="act-unarchive" /></td></tr>');

                    (function(address) {
                        tr.find('.act-unarchive').click(function() {
                            MyWallet.unArchiveAddr(address);
                        });
                    })(addr.addr);

                    if (addr.balance > 0 && addr.priv)  {
                        table.prepend(tr);
                    } else {
                        table.append(tr);
                    }
                }
            }

            build();

            BlockchainAPI.get_balances(archived, function(obj) {
                build();
            }, function(e) {
                MyWallet.makeNotice('error', 'misc-error', e);
            });
        });

        $('#archived-sweep').click(function() {

            var toSweep = [];

            $('.archived_checkbox:checked').each(function() {
                var addr = addresses[$(this).val()];

                if (addr.priv == null) {
                    MyWallet.makeNotice('error', 'misc-error', 'Cannot Sweep Watch Only Address');
                    return;
                }

                toSweep.push(addr.addr);
            });


            if (toSweep.length == 0)
                return;

            sweepAddresses(toSweep);
        });

        $('#archived-delete').click(function() {

            var toDelete = [];

            $('.archived_checkbox:checked').each(function() {
                toDelete.push($(this).val());
            });

            if (toDelete.length == 0)
                return;

            deleteAddresses(toDelete);
        });

        $('#shared-never-ask').click(function() {
            SetCookie('shared-never-ask', $(this).is(':checked'));
        });

        $('.bitstamp-btn').click(function() {
            window.open(root + 'r?url=https://www.bitstamp.net/?blockchaininfo=1', null, "scroll=1,status=1,location=1,toolbar=1,width=1000,height=700");
        });


        $('.deposit-btn').click(function() {
            var self = $(this);
            var address = MyWallet.getPreferredAddress();

            var extra = self.data('extra');
            if (extra == null) extra = '';

            loadScript('wallet/frame-modal', function() {
                showFrameModal({
                    title : self.data('title'),
                    description : 'Deposit into address <b>'+address+'</b>',
                    top_right : 'Have Questions? Read <a href="'+self.data('link')+'" target="new">How It Works</a>',
                    src : root + 'deposit?address='+address+'&ptype='+self.data('type')+'&guid='+guid+'&sharedKey='+sharedKey+extra
                });
            });
        });

        $('.withdraw-btn').click(function() {
            var self = $(this);
            MyWallet.getSecondPassword(function() {
                var address = MyWallet.getPreferredAddress();
                loadScript('wallet/frame-modal', function() {
                    showFrameModal({
                        title : self.data('title'),
                        description : 'Your Wallet Balance is <b>'+formatBTC(final_balance)+'</b>',
                        src : root + 'withdraw?method='+self.data('type')+'&address='+address+'&balance='+final_balance+'&guid='+guid+'&sharedKey='+sharedKey
                    });
                });
            });
        });

        $('#logout').click(MyWallet.logout);

        $('#refresh').click(function () {
            getWallet();

            MyWallet.get_history();
        });

        $('#summary-n-tx-chart').click(function() {
            window.open(root + 'charts/n-transactions?show_header=false&address='+MyWallet.getActiveAddresses().join('|'), null, "scroll=0,status=0,location=0,toolbar=0,width=1000,height=700");
        });

        $('#summary-received-chart').click(function() {
            window.open(root + 'charts/received-per-day?show_header=false&address='+MyWallet.getActiveAddresses().join('|'), null, "scroll=0,status=0,location=0,toolbar=0,width=1000,height=700");
        });

        $('#summary-balance-chart').click(function() {
            window.open(root + 'charts/balance?show_header=false&address='+MyWallet.getActiveAddresses().join('|'), null, "scroll=0,status=0,location=0,toolbar=0,width=1000,height=700");
        });

        $("#new-addr").click(function() {
            try {
                getWallet(function() {
                    MyWallet.getSecondPassword(function() {
                        var key = MyWallet.generateNewKey();

                        if (!key) return;

                        var address = key.getBitcoinAddress().toString();

                        MyWallet.backupWallet('update', function() {
                            MyWallet.makeNotice('info', 'new-address', 'Generated new Bitcoin Address ' + address);

                            loadScript('wallet/address_modal', function() {
                                showLabelAddressModal(address);
                            });
                        });
                    });
                });
            } catch (e) {
                MyWallet.makeNotice('error', 'misc-error', e);
            }
        });

        $('.tx_filter a').click(function(){
            tx_page = 0;
            tx_filter = $(this).data('value');

            MyWallet.get_history();
        });

        $('.tx_display a').click(function(){
            var value = $(this).data('value');
            if (value == 'export') {
                exportHistory();
                return;
            }

            wallet_options.tx_display = value;

            buildVisibleView();

            backupWalletDelayed();
        });

        $('#email-backup-btn').click(function() {
            emailBackup();
        });

        $('#dropbox-backup-btn').click(function() {
            window.open(root + 'wallet/dropbox-login?guid=' + guid + '&sharedKey=' + sharedKey);
        });

        $('#gdrive-backup-btn').click(function() {
            window.open(root + 'wallet/gdrive-login?guid=' + guid + '&sharedKey=' + sharedKey);
        });

        $('#large-summary').click(function() {
            toggleSymbol();

            buildVisibleView();
        });

        $('#send-quick').on('show', function(e, reset) {
            var self = $(this);

            buildSendForm(self, reset);

            self.find('.send').unbind().click(function() {
                loadScript('wallet/signer', function() {
                    startTxUI(self, 'quick', initNewTx());
                });
            });
        });

        $('#send-email').on('show', function(e, reset) {
            var self = $(this);

            buildSendForm(self, reset);

            self.find('.send').unbind().click(function() {
                loadScript('wallet/signer', function() {
                    startTxUI(self, 'email', initNewTx());
                });
            });
        });

        $('#send-shared').on('show', function(e, reset) {
            var self = $(this);

            buildSendForm(self, reset);

            self.find('.mixer_fee').text(mixer_fee);

            self.find('.fees,.free,.bonus').show();
            if (mixer_fee < 0) {
                self.find('.fees,.free').hide();
            } else if (mixer_fee == 0) {
                self.find('.fees,.bonus').hide();
            } else {
                self.find('.free,.bonus').hide();
            }

            self.find('.send').unbind().click(function() {
                loadScript('wallet/signer', function() {
                    startTxUI(self, 'shared', initNewTx());
                });
            });

            self.find('.shared-fees').text('0.00');
            self.find('input[name="send-before-fees"]').unbind().bind('keyup change', function() {
                var input_value = parseFloat($(this).val());

                var real_tx_value = 0;

                if (input_value > 0) {
                    if (mixer_fee > 0) {
                        real_tx_value = parseFloat(input_value + ((input_value / 100) *  mixer_fee));
                    } else {
                        real_tx_value = parseFloat(input_value);

                        self.find('.bonus-value').text(formatPrecision((Math.min(input_value, precisionFromBTC(200)) / 100) * mixer_fee));
                    }
                }

                if (precisionToBTC(input_value) < 0.1 || precisionToBTC(input_value) > 250) {
                    self.find('.shared-fees').text('0.00');

                    self.find('.send').prop('disabled', true);
                } else {
                    self.find('.shared-fees').text(formatBTC(real_tx_value*symbol_btc.conversion));

                    self.find('.send').prop('disabled', false);
                }

                self.find('input[name="send-value"]').val(real_tx_value).trigger('keyup');
            })
        });

        $('#send-custom').on('show',  function(e, reset) {
            var self = $(this);

            buildSendForm(self, reset);

            self.find('.send').unbind().click(function() {
                loadScript('wallet/signer', function() {
                    startTxUI(self, 'custom', initNewTx());
                });
            });

            self.find('select[name="from"]').unbind().change(function() {
                var total_selected = 0;

                var values = $(this).val();
                for (var i in values) {
                    if (values[i] == 'any') {
                        $(this).val('any');

                        total_selected = final_balance;
                        break;
                    } else {
                        var addr = addresses[values[i]];
                        if (addr && addr.balance)
                            total_selected += addr.balance;
                    }
                }

                self.find('.amount-available').text(formatBTC(total_selected));
            }).trigger('change');

            self.find('.reset').unbind().click(function() {
                buildSendForm(self, true);

                self.find('select[name="from"]').trigger('change');
            });
        });

        $('#send-satoshi-dice,#send-btcdice-dice').on('show', function(e, reset) {
            var self = this;

            loadScript('wallet/dicegames', function() {
                try {
                    DICEGame.init($(self));
                } catch (e) {
                    MyWallet.makeNotice('error', 'misc-error', 'Unable To Load Dice Bets');
                }
            }, function (e) {
                MyWallet.makeNotice('error', 'misc-error', e);
            });
        });

        $('#send-sms').on('show', function(e, reset) {
            if (reset)
                return;

            var self = $(this);

            buildSendForm(self);


            $.ajax({
                type: "GET",
                url: resource + 'wallet/country_codes.html',
                success: function(data) {
                    self.find('select[name="sms-country-code"]').html(data);
                },
                error : function() {
                    MyWallet.makeNotice('error', 'misc-error', 'Error Downloading SMS Country Codes')
                }
            });

            self.find('.send').unbind().click(function() {
                loadScript('wallet/signer', function() {
                    var pending_transaction = initNewTx();

                    startTxUI(self, 'sms', pending_transaction);
                });
            });
        });


        $('#address-book').on('show', function() {
            var el = $('#address-book-tbl tbody');

            if (nKeys(address_book) > 0) {
                el.empty();

                for (var address in address_book) {
                    var tr = $('<tr><td>'+ address_book[address] + '</td><td><div class="addr-book-entry">'+ address + '</div></td><td style="width:16px" class="hidden-phone"><img src="'+resource+'delete.png" class="act-delete" /></td></tr>');

                    (function(address) {
                        tr.find('.act-delete').click(function() {
                            MyWallet.deleteAddressBook(address);
                        });
                    })(address);

                    el.append(tr);
                }
            }
        });

        $('a[data-toggle="tab"]').unbind().on('show', function(e) {
            $(e.target.hash).trigger('show');
        });


        $("#receive-coins-btn").click(function() {
            changeView($("#receive-coins"));
        });

        $('.show_adv').click(function() {
            $('.modal:visible').center();
        });

        $('.download-backup-btn').show();

        buildPopovers();
    }

    function bindInitial() {
        $('.resend-code').click(function() {
            MyWallet.setGUID(guid, true);
        });

        $('.download-backup-btn').toggle(encrypted_wallet_data != null).click(function() {
            $(this).attr('download', "wallet.aes.json");

            if (!encrypted_wallet_data) {
                MyWallet.makeNotice('error', 'error', 'No Wallet Data to Download');
                return;
            }

            var downloadAttrSupported = ("download" in document.createElement("a"));

            //Chrome supports downloading through the download attribute
            if (window.Blob && window.URL && downloadAttrSupported) {
                var blob = new Blob([encrypted_wallet_data]);

                var blobURL = window.URL.createObjectURL(blob);

                $(this).attr('href', blobURL);
            } else {
                //Other browsers we just open a popup with the text content
                var popup = window.open(null, null, "width=700,height=800,toolbar=0");

                popup.document.write('<!DOCTYPE html><html><head></head><body><div style="word-wrap:break-word;" >'+encrypted_wallet_data+'</div></body></html>');
            }

            backupInstructionsModal();
        });

        $('.auth-0,.auth-1,.auth-2,.auth-3,.auth-4,.auth-5').unbind().keypress(function(e) {
            if(e.keyCode == 13) { //Pressed the return key
                e.preventDefault();

                $('#restore-wallet-continue').click();
            }
        });

        $("#restore-wallet-continue").unbind().click(function(e) {
            e.preventDefault();

            var tguid = $.trim($('#restore-guid').val());

            if (tguid.length == 0)
                return;

            if (guid != tguid) {
                MyWallet.setGUID(tguid, false);
            } else {
                restoreWallet();
            }
        });

        $('.modal').on('show', function() {
            hidePopovers();

            $(this).center();
        }).on('shown', function() {
                hidePopovers();

                $(this).center();
            })
    }

    function parseMiniKey(miniKey) {
        var check = Crypto.SHA256(miniKey + '?');

        switch(check.slice(0,2)) {
            case '00':
                var decodedKey = Crypto.SHA256(miniKey, {asBytes: true});
                return decodedKey;
                break;
            case '01':
                var x          = Crypto.util.hexToBytes(check.slice(2,4))[0];
                var count      = Math.round(Math.pow(2, (x / 4)));
                var decodedKey = Crypto.PBKDF2(miniKey, 'Satoshi Nakamoto', 32, { iterations: count, asBytes: true});
                return decodedKey;
                break;
            default:
                console.log('invalid key');
                break;
        }
    };

    function getSelectionText() {
        var sel, html = "";
        if (window.getSelection) {
            sel = window.getSelection();
            if (sel.rangeCount) {
                var frag = sel.getRangeAt(0).cloneContents();
                var el = document.createElement("div");
                el.appendChild(frag);
                html = el.innerText;
            }
        } else if (document.selection && document.selection.type == "Text") {
            html = document.selection.createRange().htmlText;
        }
        return html;
    }

    this.detectPrivateKeyFormat = function(key) {
        // 51 characters base58, always starts with a '5'
        if (/^5[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{50}$/.test(key))
            return 'sipa';

        //52 character compressed starts with L or K
        if (/^[LK][123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{51}$/.test(key))
            return 'compsipa';

        // 52 characters base58
        if (/^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{44}$/.test(key) || /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{43}$/.test(key))
            return 'base58';

        if (/^[A-Fa-f0-9]{64}$/.test(key))
            return 'hex';

        if (/^[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789=+\/]{44}$/.test(key))
            return 'base64';

        if (/^6P[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{56}$/.test(key))
            return 'bip38';

        if (/^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{21}$/.test(key) ||
            /^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{25}$/.test(key) ||
            /^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{29}$/.test(key) ||
            /^S[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{30}$/.test(key)) {

            var testBytes = Crypto.SHA256(key + "?", { asBytes: true });

            if (testBytes[0] === 0x00 || testBytes[0] === 0x01)
                return 'mini';
        }

        throw 'Unknown Key Format ' + key;
    }

    this.privateKeyStringToKey = function(value, format) {

        var key_bytes = null;

        if (format == 'base58') {
            key_bytes = B58.decode(value);
        } else if (format == 'base64') {
            key_bytes = Crypto.util.base64ToBytes(value);
        } else if (format == 'hex') {
            key_bytes = Crypto.util.hexToBytes(value);
        } else if (format == 'mini') {
            key_bytes = parseMiniKey(value);
        } else if (format == 'sipa') {
            var tbytes = B58.decode(value);
            tbytes.shift();
            key_bytes = tbytes.slice(0, tbytes.length - 4);
        } else if (format == 'compsipa') {
            var tbytes = B58.decode(value);
            tbytes.shift();
            tbytes.pop();
            key_bytes = tbytes.slice(0, tbytes.length - 4);
        } else {
            throw 'Unsupported Key Format';
        }

        if (key_bytes.length != 32)
            throw 'Result not 32 bytes in length';

        return new Bitcoin.ECKey(key_bytes);
    }

    $(document).ready(function() {

        if (!$.isEmptyObject({})) {
            MyWallet.makeNotice('error', 'error', 'Object.prototype has been extended by a browser extension. Please disable this extensions and reload the page.');
            return;
        }

        //Disable autocomplete in firefox
        $("input,button,select").attr("autocomplete","off");

        var body = $(document.body);

        function tSetGUID() {
            if (guid && guid.length == 36) {
                setTimeout(function(){
                    MyWallet.setGUID(guid, false);
                }, 10);
            }
        }

        //Load data attributes from html
        guid = body.data('guid');
        sharedKey = body.data('sharedkey');

        //Deposit pages set this flag so it can be loaded in an iframe
        if (MyWallet.skip_init)
            return;

        MyStore.get('payload', function(result) {
            if (encrypted_wallet_data == null && result != null) {
                encrypted_wallet_data = result;
                payload_checksum = generatePayloadChecksum();
            }
        });

        if ((!guid || guid.length == 0) && (isExtension || window.location.href.indexOf('/login') > 0)) {
            MyStore.get('guid', function(result) {
                guid = result;

                tSetGUID();
            });
        } else {
            tSetGUID();
        }

        //Frame break
        if (top.location != self.location) {
            top.location = self.location.href
        }

        body.click(function() {
            if (logout_timeout) {
                clearTimeout(logout_timeout);
                logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());
            }

            rng_seed_time();
        }).keypress(function() {
                if (logout_timeout) {
                    clearTimeout(logout_timeout);
                    logout_timeout = setTimeout(MyWallet.logout, MyWallet.getLogoutTime());
                }

                rng_seed_time();
            }).mousemove(function(event) {
                if (event) {
                    rng_seed_int(event.clientX * event.clientY);
                }
            });

        bindInitial();

        $('.auth-'+auth_type).show();

        cVisible = $("#restore-wallet");

        cVisible.show();

        //Show a warning when the Users copies a watch only address to the clipboard
        var ctrlDown = false;
        var ctrlKey = 17, vKey = 86, cKey = 67, appleKey = 67;
        $(document).keydown(function(e) {
            try {
                if (e.keyCode == ctrlKey || e.keyCode == appleKey)
                    ctrlDown = true;

                if (ctrlDown &&  e.keyCode == cKey) {
                    var selection = $.trim(getSelectionText());

                    var addr = addresses[selection];

                    if (addr != null) {
                        if (addr.priv == null) {
                            $('#watch-only-copy-warning-modal').modal('show');
                        } else if (addr.tag == 1) {
                            showNotSyncedModal();
                        }
                    }
                }
            } catch (e) {
                console.log(e);
            }
        }).keyup(function(e) {
                if (e.keyCode == ctrlKey || e.keyCode == appleKey)
                    ctrlDown = false;
            }).ajaxStart(function() {
                setLogoutImageStatus('loading_start');

                $('.loading-indicator').fadeIn(200);
            }).ajaxStop(function() {
                setLogoutImageStatus('loading_stop');

                $('.loading-indicator').hide();
            });
    });

    function buildReceiveCoinsView() {
        $('#receive-coins').find('.tab-pane.active').trigger('show');

        setupToggle();
    }
};