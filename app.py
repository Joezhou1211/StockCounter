from flask import Flask, render_template

app = Flask(__name__)
@app.route('/')
def choose_mode():
    """模式选择页面"""
    return render_template('select_mode.html')


@app.route('/mode1')
def mode1():
    """点货模式（原模式1）"""
    return render_template('index.html')


@app.route('/mode2')
def mode2():
    """盘点模式（模式2）"""
    return render_template('mode2.html')

# 教程 / 帮助
@app.route('/tutorial')
def tutorial():
    """使用教程页面"""
    return render_template('tutorial.html')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=7001, debug=False)
