/*
 * Copyright 2016, OpenRemote Inc.
 *
 * See the CONTRIBUTORS.txt file in the distribution for a
 * full listing of individual contributors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */
package org.openremote.app.client.app.dialog;

import com.google.gwt.user.client.ui.Label;
import org.openremote.app.client.i18n.ManagerMessages;
import org.openremote.app.client.style.WidgetStyle;
import org.openremote.app.client.widget.PushButton;
import org.openremote.model.interop.Runnable;

public class Confirmation {

    final protected Dialog dialog;

    protected Runnable onConfirm;
    protected Runnable onCancel;

    public Confirmation(WidgetStyle widgetStyle,
                        ManagerMessages managerMessages) {
        this.dialog = new Dialog();

        dialog.setModal(true);
        dialog.setAutoHideOnHistoryEvents(true);
        dialog.addStyleName(widgetStyle.ConfirmationDialog());

        PushButton confirmButton = new PushButton();
        confirmButton.setFocus(true);
        confirmButton.setText(managerMessages.OK());
        confirmButton.setIcon("check");
        confirmButton.addStyleName(widgetStyle.FormControl());
        confirmButton.addStyleName(widgetStyle.PushButton());
        confirmButton.addStyleName(widgetStyle.FormButtonPrimary());
        confirmButton.addClickHandler(event -> {
            dialog.close();
            if (onConfirm != null)
                onConfirm.run();
        });
        dialog.getFooterPanel().add(confirmButton);

        PushButton cancelButton = new PushButton();
        cancelButton.setText(managerMessages.cancel());
        cancelButton.setIcon("close");
        cancelButton.addStyleName(widgetStyle.FormControl());
        cancelButton.addStyleName(widgetStyle.PushButton());
        cancelButton.addStyleName(widgetStyle.FormButton());
        cancelButton.addClickHandler(event -> {
            dialog.close();
            if (onCancel != null)
                onCancel.run();
        });
        dialog.getFooterPanel().add(cancelButton);
    }

    public void setTitle(String title) {
        dialog.setHeaderLabel(title);
    }

    public void setText(String text) {
        dialog.getContentPanel().add(new Label(text));
    }

    public void setOnConfirm(Runnable onConfirm) {
        this.onConfirm = onConfirm;
    }

    public void setOnCancel(Runnable onCancel) {
        this.onCancel = onCancel;
    }

    public void show() {
        dialog.open();
    }
}